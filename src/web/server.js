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
require("../env").loadEnv();
const store = require("../store/state");
const { Ledger } = require("../evidence/ledger");
const { SERVICES } = require("../lgtm/client");
const { approveProposal, applyGithubPrProposal } = require("../actions/proposals");
const { reviseRemediation } = require("../actions/remediation");
const { loadedPractices, PRACTICES_DIR, DOCS } = require("../practices");
const { probeStack } = require("../lgtm/health");

const PORT = Number(process.env.SRE_WEB_PORT) || 8420;
const DIST_DIR = path.join(__dirname, "..", "..", "web", "dist");

// Where the agent opens its fix PRs. Read from the environment, never hardcoded — the repo
// is the team's own, set once during onboarding (.hackathon-team.json / .env).
function githubTarget() {
  const slug = process.env.GITHUB_REPO || "";
  const [owner, repo] = slug.split("/");
  return { owner, repo, token: process.env.GITHUB_TOKEN, slug };
}

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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("request body too large"));
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function findProposal(id) {
  return (store.load().proposals || []).find((p) => p.id === id) || null;
}

// The three things a human can do about a drafted fix. None of them is the agent asking
// permission to think — it already reasoned and drafted on its own. These are the review
// gate on the one action that touches the outside world.
async function handleProposalAction(req, res, id, action) {
  const proposal = findProposal(id);
  if (!proposal) return sendJson(res, 404, { error: `no proposal '${id}'` });

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  if (action === "reject") {
    store.update((s) => {
      const p = (s.proposals || []).find((x) => x.id === id);
      if (p) {
        p.status = "rejected";
        p.rejectedAt = new Date().toISOString();
        p.rejectionReason = body.reason || "(no reason given)";
      }
    });
    return sendJson(res, 200, { ok: true, status: "rejected" });
  }

  // Malleability, exercised for real: the human pushes back in prose and the agent
  // re-reasons over its own proposal plus that objection, producing a revised draft. It is
  // not a form field the human edits — the agent rewrites the fix itself.
  if (action === "revise") {
    if (!body.feedback || !String(body.feedback).trim()) {
      return sendJson(res, 400, { error: "revise requires a non-empty 'feedback' field" });
    }
    try {
      const revised = await reviseRemediation(proposal, String(body.feedback));
      return sendJson(res, 200, { ok: true, proposal: revised });
    } catch (err) {
      return sendJson(res, 502, { error: `revision failed: ${err.message}` });
    }
  }

  if (action === "approve") {
    // Only a live draft can be approved. Re-approving something already applied would open a
    // second PR for the same fix; approving something withdrawn or rejected would undo a
    // decision that was already made deliberately.
    if (!["draft", "revised", "apply_failed"].includes(proposal.status)) {
      return sendJson(res, 409, {
        error: `proposal '${id}' is '${proposal.status}' — only a draft, revised, or previously-failed proposal can be approved`,
      });
    }

    const { owner, repo, token, slug } = githubTarget();
    if (!owner || !repo || !token) {
      return sendJson(res, 503, {
        error:
          "GitHub is not configured — set GITHUB_REPO (owner/repo) and GITHUB_TOKEN in .env. " +
          `Currently GITHUB_REPO='${slug}', token ${token ? "set" : "missing"}.`,
      });
    }
    try {
      const approved = approveProposal(id);
      const result = await applyGithubPrProposal(approved, { owner, repo, token });
      return sendJson(res, 200, { ok: true, status: "applied", ...result });
    } catch (err) {
      // applyGithubPrProposal already recorded 'apply_failed' + the error on the proposal.
      return sendJson(res, 502, { error: err.message });
    }
  }

  return sendJson(res, 404, { error: `unknown proposal action '${action}'` });
}

function handleApi(req, res, url) {
  if (url.pathname === "/api/state" && req.method === "GET") {
    const state = store.load();
    const { slug, token } = githubTarget();
    return sendJson(res, 200, {
      ...state,
      services: SERVICES,
      // Lets the dashboard say exactly where a PR would land, and warn honestly when the
      // approve path would fail, instead of only finding out on click.
      github: { repo: slug, configured: Boolean(slug && token) },
      // The operating procedure the agent is actually running under. Surfacing it here means
      // a reviewer can see the guardrails rather than take them on trust.
      practices: loadedPractices(),
    });
  }

  if (url.pathname === "/api/practices" && req.method === "GET") {
    const docs = DOCS.map((doc) => {
      try {
        return { ...doc, content: fs.readFileSync(path.join(PRACTICES_DIR, doc.file), "utf8") };
      } catch {
        return { ...doc, content: null };
      }
    });
    return sendJson(res, 200, { docs });
  }

  const proposalAction = url.pathname.match(/^\/api\/proposals\/([^/]+)\/([^/]+)$/);
  if (proposalAction && req.method === "POST") {
    return handleProposalAction(req, res, proposalAction[1], proposalAction[2]);
  }

  if (url.pathname.startsWith("/api/evidence/") && req.method === "GET") {
    const id = url.pathname.slice("/api/evidence/".length);
    const ledger = new Ledger();
    const entry = ledger.get(id);
    if (!entry) return sendJson(res, 404, { error: `no evidence entry '${id}'` });
    return sendJson(res, 200, entry);
  }

  // Liveness of this container plus reachability of the backends the agent sees through.
  // Probed on request rather than served from the sweep's cache, so "is the agent blind right
  // now?" is answerable without waiting up to 45s for the next sweep.
  if (url.pathname === "/api/health" && req.method === "GET") {
    return probeStack()
      .then((checks) => {
        const stored = store.load().health || null;
        const allUp = Object.values(checks).every((c) => c.up);
        sendJson(res, allUp ? 200 : 503, {
          ok: allUp,
          at: new Date().toISOString(),
          backends: checks,
          fleet: stored
            ? { at: stored.at, reachable: stored.reachable, services: stored.services?.length || 0 }
            : null,
        });
      })
      .catch((err) => sendJson(res, 503, { ok: false, error: err.message }));
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
