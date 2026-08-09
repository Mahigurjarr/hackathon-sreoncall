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
ENTRYPOINT ["./docker-entrypoint.sh"]
