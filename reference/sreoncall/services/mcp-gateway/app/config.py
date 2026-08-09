from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (case-insensitive)."""

    model_config = SettingsConfigDict(env_file=None)

    # Internal Node API base URL this gateway relays MCP traffic to. Prefer the
    # internal IP over the public https://web.sreoncall.com edge once reachability
    # is confirmed — avoids an extra TLS handshake + nginx hop (see repo plan doc).
    sreoncall_api_url: str = "http://10.10.1.22:8000"

    # Upstream request timeout. MCP tool calls can involve real DB queries and,
    # for query_metrics, an upstream PromQL round trip — keep generous.
    upstream_timeout_seconds: float = 30.0
    upstream_connect_timeout_seconds: float = 5.0

    # Per-connecting-address token bucket. Deliberately coarse for v1
    # (in-memory, per-pod — not globally accurate across the Deployment's 2
    # replicas, so real capacity is closer to 2x this before either replica
    # throttles). This is defense-in-depth against unauthenticated traffic
    # only, not the authoritative limiter: once a request reaches Node with a
    # verified API key, rateLimitMiddleware's Redis-backed per-tenant window
    # is the real, replica-accurate control.
    rate_limit_capacity: int = 30
    rate_limit_refill_per_second: float = 0.5


settings = Settings()
