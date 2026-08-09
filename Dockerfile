# --- Stage 1: build the React dashboard -------------------------------------------------
FROM node:24-alpine AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: runtime ---------------------------------------------------------------------
# The backend itself has zero npm dependencies (see CONTRACTS.md) — nothing to install here,
# just copy source. The built dashboard from stage 1 is served by src/web/server.js directly.
FROM node:24-alpine
WORKDIR /app

COPY src/ ./src/
COPY bin/ ./bin/
COPY sre-as-code/ ./sre-as-code/
COPY --from=web-builder /app/web/dist ./web/dist
COPY docker-entrypoint.sh ./

RUN chmod +x bin/sre docker-entrypoint.sh && mkdir -p store

EXPOSE 8420

# One image, two roles. docker-compose.yml runs it twice with different `command`s — the API
# and the sentinel — so they fail and restart independently.
#
# Deliberately no ENTRYPOINT: an ENTRYPOINT would capture compose's `command` as arguments to
# itself rather than replacing it, which is exactly how the old single-container setup forced
# both processes into one lifecycle. Healthchecks live in compose, per role, because the
# sentinel has no port and cannot be probed the same way as the API.
CMD ["node", "src/web/server.js"]
