// Read-only JSON API for the web dashboard. This file makes no judgement calls of its
// own — it is a thin, honest passthrough of store/state.json (the exact same data
// bin/sre reads), so the dashboard and the CLI can never disagree about what the
// backend actually found. Zero npm dependencies: node:http only, matching the rest
// of src/.
//
// In dev, the web/ Vite app proxies /api to this server (see web/vite.config.js), so
// no CORS handling is needed. If web/dist exists (a production build), this server
// also serves it directly, so `node src/web/server.js` alone is enough to run both.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const store = require("../store/state");
const { Ledger } = require("../evidence/ledger");
const { SERVICES } = require("../lgtm/client");

const PORT = Number(process.env.SRE_WEB_PORT) || 8420;
const DIST_DIR = path.join(__dirname, "..", "..", "web", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

function handleApi(req, res, url) {
  if (url.pathname === "/api/state" && req.method === "GET") {
    const state = store.load();
    return sendJson(res, 200, { ...state, services: SERVICES });
  }

  if (url.pathname.startsWith("/api/evidence/") && req.method === "GET") {
    const id = url.pathname.slice("/api/evidence/".length);
    const ledger = new Ledger();
    const entry = ledger.get(id);
    if (!entry) return sendJson(res, 404, { error: `no evidence entry '${id}'` });
    return sendJson(res, 200, entry);
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, at: new Date().toISOString() });
  }

  return sendJson(res, 404, { error: `no such API route: ${req.method} ${url.pathname}` });
}

function serveStatic(req, res, url) {
  if (!fs.existsSync(DIST_DIR)) {
    return sendJson(res, 404, {
      error: "web/dist not built. Run `npm run build` in web/, or run `npm run dev` there for the dev server.",
    });
  }

  let filePath = path.join(DIST_DIR, decodeURIComponent(url.pathname));
  if (url.pathname === "/" || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, "index.html"); // SPA fallback
  }

  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[web] API server listening on http://localhost:${PORT}`);
    console.log(`[web] serving web/dist if built, otherwise run 'npm run dev' inside web/`);
  });
}

module.exports = { server };
