import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from .config import settings
from .rate_limit import RateLimiter

logger = logging.getLogger("mcp_gateway")

# Response headers that must never be forwarded verbatim: they describe the
# hop-to-hop transport between us and Node, not between us and the MCP client.
# NOTE: content-encoding is deliberately NOT here — body_stream() forwards
# Node's response bytes untouched, so if we ever stripped this header while
# leaving compressed bytes in place, the MCP client's JSON/SSE parser would
# choke on bytes it has no way to know are encoded.
_HOP_BY_HOP_HEADERS = {"transfer-encoding", "connection", "keep-alive"}

# Matches Node's express.json({ limit: '5mb' }) — kept in sync so a request
# that would be rejected there is rejected here first, before this process
# buffers the body at all.
_MAX_BODY_BYTES = 5 * 1024 * 1024


class _PayloadTooLarge(Exception):
    pass


async def _read_bounded_body(request: Request, max_bytes: int) -> bytes:
    """Reads the request body while enforcing a hard byte cap. `request.body()`
    has no such cap, so an unauthenticated caller (identity isn't checked
    until Node's apiKeyAuthMiddleware, after this proxy has already relayed
    the request) could otherwise force this process to buffer an arbitrarily
    large payload in memory. Content-Length is checked first as a fast-fail,
    but isn't trusted alone since it's caller-supplied and optional."""
    content_length = request.headers.get("content-length")
    if content_length is not None and content_length.isdigit() and int(content_length) > max_bytes:
        raise _PayloadTooLarge()

    total = 0
    chunks: list[bytes] = []
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise _PayloadTooLarge()
        chunks.append(chunk)
    return b"".join(chunks)


def _client_address(request: Request) -> str:
    """Best-effort originating client address, consistent with how the rest
    of this stack already trusts X-Forwarded-For (Node runs with
    `app.set('trust proxy', true)` and takes the leftmost entry as the real
    client for every other route) — this proxy is the first hop capable of
    seeing that header at all, so it resolves the same way here."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.http_client = httpx.AsyncClient(
        base_url=settings.sreoncall_api_url,
        timeout=httpx.Timeout(settings.upstream_timeout_seconds, connect=settings.upstream_connect_timeout_seconds),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    )
    app.state.rate_limiter = RateLimiter(
        capacity=settings.rate_limit_capacity,
        refill_per_second=settings.rate_limit_refill_per_second,
    )
    try:
        yield
    finally:
        await app.state.http_client.aclose()


app = FastAPI(title="SREonCall MCP Gateway", version="0.1.0", lifespan=lifespan)


def _jsonrpc_error(code: int, message: str, status_code: int) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": None}, status_code=status_code)


@app.get("/healthz")
async def healthz() -> dict:
    """Liveness — process is up. Does not depend on the upstream API."""
    return {"status": "ok"}


@app.get("/readyz")
async def readyz(request: Request) -> Response:
    """Readiness — can we actually reach the Node API this gateway relays to."""
    client: httpx.AsyncClient = request.app.state.http_client
    try:
        resp = await client.get("/health", timeout=httpx.Timeout(5.0))
    except httpx.HTTPError as exc:
        return JSONResponse({"status": "not_ready", "error": str(exc)}, status_code=503)
    if resp.status_code >= 500:
        return JSONResponse({"status": "not_ready", "upstream_status": resp.status_code}, status_code=503)
    return JSONResponse({"status": "ready"})


@app.post("/mcp")
async def proxy_mcp(request: Request) -> Response:
    """Authenticated streaming reverse proxy to Node's /mcp Streamable HTTP
    endpoint. Deliberately does no MCP protocol parsing — see repo plan doc:
    all tool/business logic lives in Node's mcp/tools.ts; this layer only
    terminates the public endpoint, authenticates fast-fail, rate-limits, and
    streams bytes through untouched (never buffers — Streamable HTTP responses
    can be long-lived SSE)."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer ") or len(auth_header) <= len("Bearer "):
        return _jsonrpc_error(-32001, "Missing or invalid Authorization header", status_code=401)

    client_address = _client_address(request)
    rate_limiter: RateLimiter = request.app.state.rate_limiter
    # Keyed on the connecting address, NOT the bearer token: the token is
    # unverified at this layer (that only happens later, in Node's
    # apiKeyAuthMiddleware), so a caller varying it per request would
    # otherwise get a brand-new, full bucket for free every time.
    if not rate_limiter.allow(client_address):
        return _jsonrpc_error(-32002, "Rate limit exceeded", status_code=429)

    client: httpx.AsyncClient = request.app.state.http_client
    try:
        body = await _read_bounded_body(request, _MAX_BODY_BYTES)
    except _PayloadTooLarge:
        return _jsonrpc_error(-32003, "Request body too large", status_code=413)

    forward_headers = {
        "authorization": auth_header,
        "content-type": request.headers.get("content-type", "application/json"),
        "accept": request.headers.get("accept", "application/json, text/event-stream"),
        # So Node's audit log (actor.ip, via req.ip under trust proxy: true)
        # records the real caller instead of this gateway pod's own address.
        "x-forwarded-for": client_address,
    }

    upstream_request = client.build_request("POST", "/mcp", content=body, headers=forward_headers)
    try:
        upstream_response = await client.send(upstream_request, stream=True)
    except httpx.HTTPError as exc:
        logger.error("Upstream MCP request failed: %s", exc)
        return _jsonrpc_error(-32603, "Upstream unavailable", status_code=502)

    response_headers = {
        k: v for k, v in upstream_response.headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS
    }

    async def body_stream() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream_response.aiter_raw():
                yield chunk
        finally:
            await upstream_response.aclose()

    return StreamingResponse(
        body_stream(),
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=upstream_response.headers.get("content-type"),
    )
