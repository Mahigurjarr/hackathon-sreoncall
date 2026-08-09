# Connecting your prototype to the shared LGTM stack

## First — a distinction worth getting right

**You don't need to recreate any of this stack locally.** There's nothing to install, host, or
run — you just connect your prototype to the one central LGTM stack we provide. What you're
building is **query code**: outbound calls *from* your laptop *to* the endpoints below, reading
metrics/logs/traces that already exist. There is no server you need to stand up to "receive"
anything.

If you take one thing from this doc: every connection you write is a `fetch`/`curl`/`requests.get`
call going *out* from your laptop *to* `10.10.1.139`, never the other way around.

## The four values you need (already in `.env`)

```
MANAGED_MIMIR_URL=http://10.10.1.139:9009
MANAGED_LOKI_URL=http://10.10.1.139:3100
MANAGED_TEMPO_URL=http://10.10.1.139:3200
MANAGED_LGTM_ORG_ID=hackathon
```

Every request to any of the three needs one header: `X-Scope-OrgID: hackathon`. Without it,
you'll either get an error or land in the wrong tenant's (empty) data.

**Network requirement**: you must be on the office network or VPN (an IP in `10.10.0.0/24` or
`10.10.1.0/24`) — this is enforced by a firewall rule, not a bug. `starter/lgtm-client.js`
prints a clear message if this is the problem.

## Querying metrics (Mimir — Prometheus-compatible)

```bash
curl -H "X-Scope-OrgID: hackathon" \
  "http://10.10.1.139:9009/prometheus/api/v1/query?query=up"

# see what's actually available before you write a specific query
curl -H "X-Scope-OrgID: hackathon" \
  "http://10.10.1.139:9009/prometheus/api/v1/label/__name__/values"
```

## Querying logs (Loki — LogQL)

```bash
curl -G -H "X-Scope-OrgID: hackathon" \
  --data-urlencode 'query={service_name=~".+"}' \
  --data-urlencode 'limit=20' \
  "http://10.10.1.139:3100/loki/api/v1/query_range"
```

## Querying traces (Tempo)

```bash
curl -H "X-Scope-OrgID: hackathon" \
  "http://10.10.1.139:3200/api/search?tags=service.name%3Dfrontend-web&limit=5"
```

## A starter is included — you don't have to start from a blank file

`starter/lgtm-client.js` is a working example connection, ready to run: `node
starter/lgtm-client.js`. Use it as-is, or as a reference for the same calls in whatever
language you're building in.

## Your AI key

Also lives in `.env` — `OPENAI_API_KEY`, the one your team was issued. It's what your
prototype uses to actually reason about the signal it pulls back, unrelated to the LGTM
connection above.
