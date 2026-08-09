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
const { probeStack, assessHealth } = require("../lgtm/health");
const { askCopilot } = require("../copilot/assistant");
const { extractLesson } = require("../memory/lessons");

const PORT = Number(process.env.SRE_WEB_PORT) || 8420;
const DIST_DIR = path.join(__dirname, "..", "..", "web", "dist");

// Where the agent opens its fix PRs. Read from the environment, never hardcoded — the repo
// is the team's own, set once during onboarding (.hackathon-team.json / .env).
function githubTarget() {
  const slug = process.env.GITHUB_REPO || "";
  const [owner, repo] = slug.split("/");
  return { owner, repo, token: process.env.GITHUB_TOKEN, slug };
}

// How many recent metric readings keep their raw response inline in /api/state.
// The dashboard's trend charts read `raw.data.result[].value[1]` directly, so those bodies
// have to travel; every other raw body does not.
const INLINE_METRIC_RAW = 400;

// The evidence ledger is append-only and its raw responses dominate the payload — log and
// trace bodies alone were 5MB of an 8MB /api/state, re-sent on every poll, for data the
// dashboard never reads inline. It renders a raw body only inside the evidence drill-down,
// which fetches /api/evidence/:id one record at a time.
//
// So the wire payload drops the bodies it doesn't need and flags them `rawAvailable`. Nothing
// is deleted, hidden, or summarised away: the full record stays on disk and one fetch away,
// which is the line that matters — the agent's own visibility is never what gets trimmed to
// make a number look better. Only the transport is.
function trimEvidenceForWire(evidence) {
  const inlineFrom = evidence.length - INLINE_METRIC_RAW;
  return evidence.map((entry, index) => {
    if (entry.kind === "metric" && index >= inlineFrom) return entry;
    if (entry.raw === undefined || entry.raw === null) return entry;
    const { raw, ...rest } = entry;
    return { ...rest, rawAvailable: true };
  });
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

    // The broader self-learning loop: a rejection may reveal a general lesson that should
    // change every FUTURE incident's handling, not just this one (src/memory/lessons.js). This
    // runs after the rejection is already persisted and never blocks the response on it — a
    // slow or failed lesson extraction must not make a successful rejection look like it failed.
    extractLesson(proposal, body.reason, { action: "rejected" })
      .then((result) => {
        if (result.recorded) {
          console.log(`[lessons] recorded from ${id} (rejected): ${result.lesson}`);
        }
      })
      .catch(() => {}); // extractLesson already catches internally; this is belt-and-braces

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

      // The same broader self-learning loop as reject, fired from the other trigger a human
      // correction can come from. A push-back is often the richer signal — the objection AND
      // the agent's revised response are both visible — so it gets judged too, not just an
      // outright rejection. Fire-and-forget for the same reason: the revision already
      // succeeded and is already returned to the caller regardless of what this finds.
      extractLesson(proposal, String(body.feedback), { action: "pushed back on" })
        .then((result) => {
          if (result.recorded) {
            console.log(`[lessons] recorded from ${id} (push-back): ${result.lesson}`);
          }
        })
        .catch(() => {});

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
      evidence: trimEvidenceForWire(state.evidence || []),
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

  // The conversational command surface is grounded exclusively in the same persisted state
  // this API serves. It can recommend navigating to a proposal, but never approves or applies
  // one: those remain explicit routes with a human action boundary below.
  if (url.pathname === "/api/copilot" && req.method === "POST") {
    return readJsonBody(req)
      .then((body) =>
        askCopilot({
          message: body.message,
          conversationId: body.conversationId,
          role: body.role,
          context: body.context || {},
        }),
      )
      .then((result) => sendJson(res, 200, result))
      .catch((err) => {
        // Model capacity is an expected dependency state, not a malformed operator request.
        // Return a renderable availability result so the UI can explain it without the
        // browser treating the handled condition as an uncaught resource failure.
        if (/credit_balance_exhausted|insufficient_quota/.test(err.message)) {
          return sendJson(res, 200, {
            unavailable: true,
            error: "AI reasoning is temporarily unavailable because the shared hackathon model key has no remaining credits. Live monitoring continues; grounded answers will resume when the key is replenished.",
          });
        }
        return sendJson(res, 502, { error: `copilot unavailable: ${err.message}` });
      });
  }

  const copilotConversation = url.pathname.match(/^\/api\/copilot\/([^/]+)$/);
  if (copilotConversation && req.method === "GET") {
    const id = decodeURIComponent(copilotConversation[1]);
    const conversation = (store.load().copilotConversations || []).find((item) => item.id === id);
    if (!conversation) return sendJson(res, 404, { error: `no copilot conversation '${id}'` });
    return sendJson(res, 200, conversation);
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

  // Process liveness stays separate from product readiness. The API container should keep
  // serving the incident history even when a telemetry backend or the sentinel is degraded.
  if (url.pathname === "/api/live" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, at: new Date().toISOString(), service: "api" });
  }

  // Product readiness: direct checks for every telemetry backend plus the persisted sentinel
  // lifecycle. This is intentionally stricter than /api/live so a running process cannot
  // masquerade as a functioning monitoring product.
  if (url.pathname === "/api/health" && req.method === "GET") {
    return probeStack()
      .then((checks) => {
        const state = store.load();
        const stored = state.health || null;
        const assessment = assessHealth(checks, state);
        sendJson(res, assessment.ok ? 200 : 503, {
          ok: assessment.ok,
          at: new Date().toISOString(),
          backends: checks,
          sentinel: assessment.sentinel,
          telemetry: state.telemetry
            ? {
                at: state.telemetry.at,
                status: state.telemetry.status,
                frameAt: state.telemetry.frameAt,
                lastAnalyzedAt: state.telemetry.lastAnalyzedAt || null,
              }
            : null,
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

module.exports = { server, trimEvidenceForWire, INLINE_METRIC_RAW };
