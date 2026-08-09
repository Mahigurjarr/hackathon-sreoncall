# Running this locally in Docker

One container runs both the sentinel daemon (unprompted fleet sweeps → real
incidents) and the read-only web API, which also serves the built React
dashboard from the same port. `bin/sre` still works identically run directly
on the host — both read/write the same `store/state.json`, which is
volume-mounted, not baked into the image.

## Run it

```bash
docker compose up -d --build
```

Then open **http://localhost:8420** for the dashboard, or `node bin/sre status`
on the host — both see the same live state.

`docker compose logs -f` shows the daemon's sweeps as they happen.

## What's actually inside

- **Stage 1** builds `web/` (Vite + React) to static files.
- **Stage 2** is the runtime: the zero-npm-dependency backend (`src/`, `bin/`)
  plus the built dashboard, served by `src/web/server.js` on port 8420.
- `docker-entrypoint.sh` starts `node src/web/server.js` and `node bin/sre start`
  side by side; if either dies, the whole container exits so Docker's
  `restart: unless-stopped` policy recovers cleanly rather than leaving a
  half-alive container (API up, daemon dead, or vice versa).

## Secrets and state

- `.env` is **never baked into the image** (`.dockerignore` excludes it) —
  `docker-compose.yml` passes it in at container start via `env_file`, read
  from the host disk each time.
- `./store` is bind-mounted into the container at `/app/store`. State
  survives `docker compose down`/`up`, and is visible/editable from the host
  the whole time — there is exactly one `state.json`, not a copy per side.

## Verified

Built, started, and confirmed live: the container reached both the LGTM
stack (`10.10.1.139`, requires the host to already be on the office
network/VPN — Docker's default bridge networking routes outbound through
the host, so nothing extra was needed) and the OpenAI API from inside the
container; the sentinel daemon ran real sweeps inside the container
(evidence count grew from 260 → 270 during verification); the host's
`store/state.json` reflected those writes in real time; and the dashboard,
served in its actual production static-file path (not the Vite dev server),
rendered correctly with zero browser console errors.

## Stop it

```bash
docker compose down          # stop and remove the container; ./store is untouched
docker compose down -v       # also remove the named volume, if one is ever added later
```
