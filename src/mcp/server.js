// The agent's own MCP server — the same tool surface reference/sreoncall exposes
// (packages/api/src/mcp/{server,tools}.ts), reimplemented over this prototype's state.
//
// Why this exists: until now, "an agent can read this fleet's evidence and draft a gated fix"
// was a convention private to this repo — reachable only by our own daemon calling our own
// functions. That is the difference between a capability and a protocol. Exposing it over MCP
// means ANY model-driven client (Claude Code, the reference platform's orchestrator, another
// agent entirely) gets the read tools and the propose tools with the approval gate intact,
// without being able to route around it.
//
// The load-bearing property, inherited verbatim from the reference platform: **read tools query
// real data; propose_* tools NEVER write live.** They record a `draft` proposal that a human
// must approve in the dashboard. There is deliberately no approve tool, no apply tool, and no
// tool that touches the target fleet — that is guarantee 3 of sreoncall-ownership, and an MCP
// client is exactly the kind of caller it exists to constrain.
//
// Zero dependencies on purpose: the rest of this codebase is node-builtins-only, and MCP over
// stdio is JSON-RPC 2.0 with newline-delimited frames. Pulling in an SDK to write ~60 lines of
// dispatch would be the only npm dependency in the project.
//
// Run: node src/mcp/server.js   (registered in .mcp.json as the "sreoncall" server)

"use strict";

const store = require("../store/state");
const { Ledger } = require("../evidence/ledger");
const { draftProposal } = require("../actions/proposals");
const { isAllowedPath, ALLOWED_PREFIXES } = require("../actions/remediation");

const SERVER_INFO = { name: "sreoncall", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

// Logs go to stderr, always. stdout is the JSON-RPC channel — one stray console.log there
// corrupts the stream and the client drops the connection with no useful error.
function log(line) {
  process.stderr.write(`[mcp] ${line}\n`);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const str = { type: "string" };
const num = { type: "number" };

// A proposal's file set, shared by all three propose_* tools. `path` is checked against
// ALLOWED_PREFIXES below — the schema documents the constraint, the handler enforces it.
const filesSchema = {
  type: "array",
  description:
    `Files the change would add or replace. Every path must start with one of: ${ALLOWED_PREFIXES.join(", ")}`,
  items: {
    type: "object",
    properties: { path: str, content: str },
    required: ["path", "content"],
  },
};

const TOOLS = [
  // ---- read tools: real data, no side effects -----------------------------
  {
    name: "list_incidents",
    description:
      "List incidents the sentinel has opened, newest first. Each carries the service, the "
      + "model-authored headline, confidence (as policed by the hypothesis-trail policy), and "
      + "the evidence ids backing it.",
    inputSchema: {
      type: "object",
      properties: {
        status: { ...str, description: "Filter by status, e.g. 'open' or 'resolved'." },
        service: { ...str, description: "Filter by service name." },
        limit: { ...num, description: "Max incidents to return (default 20)." },
      },
    },
    handler: ({ status, service, limit = 20 }) => {
      const state = store.load();
      return [...(state.incidents || [])]
        .filter((i) => (!status || i.status === status) && (!service || i.service === service))
        .reverse()
        .slice(0, limit)
        .map((i) => ({
          id: i.id,
          status: i.status,
          service: i.service,
          headline: i.headline,
          confidence: i.confidence,
          confidence_policy: i.confidencePolicy?.policy?.reason || null,
          opened_at: i.openedAt,
          evidence_ids: i.evidence || [],
          memory_verdict: i.memory?.verdict || null,
          redemption_status: i.redemption?.status || null,
        }));
    },
  },
  {
    name: "get_incident",
    description:
      "Full detail for one incident: the cited root-cause analysis, the hypothesis trail (how "
      + "the conclusion was tested rather than declared), ordered next steps, and the "
      + "remediation outcome including a deliberate no_code_fix decline.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "Incident id, e.g. 'INC-1'." } },
      required: ["id"],
    },
    handler: ({ id }) => {
      const incident = (store.load().incidents || []).find((i) => i.id === id);
      if (!incident) throw new Error(`no incident with id '${id}'`);
      return incident;
    },
  },
  {
    name: "get_evidence",
    description:
      "Resolve an evidence id cited in any of this agent's claims to the literal query it ran "
      + "and the untouched response it got back. This is what makes a citation checkable rather "
      + "than decorative — every [E#] in an RCA or PR body resolves here.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "Evidence id, e.g. 'E110'." } },
      required: ["id"],
    },
    handler: ({ id }) => {
      const entry = new Ledger().get(id);
      if (!entry) throw new Error(`no evidence with id '${id}'`);
      return entry;
    },
  },
  {
    name: "search_evidence",
    description:
      "Search the evidence ledger by query text, summary, or target service. Returns entries "
      + "without their raw response bodies — call get_evidence for the full record.",
    inputSchema: {
      type: "object",
      properties: {
        q: { ...str, description: "Substring matched against query, summary, and target." },
        kind: { ...str, description: "Filter by 'metric', 'log', or 'trace'." },
        limit: { ...num, description: "Max entries to return (default 25)." },
      },
    },
    handler: ({ q, kind, limit = 25 }) => {
      const needle = String(q || "").toLowerCase();
      return new Ledger()
        .all()
        .filter((e) => (!kind || e.kind === kind))
        .filter((e) => !needle || `${e.query} ${e.summary} ${e.target}`.toLowerCase().includes(needle))
        .slice(-limit)
        .reverse()
        .map(({ raw, ...rest }) => ({ ...rest, raw_available: raw !== undefined && raw !== null }));
    },
  },
  {
    name: "fleet_health",
    description:
      "The most recent per-service health reading: call rate, error rate, error ratio, and "
      + "whether a service is reporting, erroring, or silent. 'silent' is reported distinctly "
      + "from 'healthy' — an absent signal is a finding, not an all-clear.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const { health, fleetSummary, lastSweep } = store.load();
      return { last_sweep: lastSweep, summary: fleetSummary?.text || null, health };
    },
  },
  {
    name: "list_proposals",
    description:
      "Every remediation proposal and its position in the draft → approved → applied state "
      + "machine, including rejections with their reason and the revision trail from human "
      + "pushback. Applied proposals carry the real PR url.",
    inputSchema: {
      type: "object",
      properties: { status: { ...str, description: "Filter by proposal status." } },
    },
    handler: ({ status }) =>
      (store.load().proposals || [])
        .filter((p) => !status || p.status === status)
        .map((p) => ({
          id: p.id,
          kind: p.kind,
          status: p.status,
          summary: p.summary,
          incident_id: p.payload?.incidentId || null,
          files: (p.payload?.files || []).map((f) => f.path),
          pr_url: p.result?.url || null,
          rejection_reason: p.rejectionReason || null,
          revisions: (p.revisions || []).length,
        })),
  },

  // ---- propose tools: draft only, human-gated -----------------------------
  ...[
    {
      name: "propose_runbook",
      title: "Propose a runbook",
      what: "a runbook",
      extra:
        "Amend an existing runbook rather than dropping a near-duplicate beside it. State "
        + "plainly what the runbook does NOT cover.",
    },
    {
      name: "propose_alert_rule",
      title: "Propose an alert rule",
      what: "an alert rule",
      extra:
        "The rule may not encode a static threshold — a comparison must be derived from real "
        + "history and cite the evidence id it came from. A rule that mutes, narrows, or "
        + "reroutes an existing signal will be refused: an agent that stops a symptom appearing "
        + "is blinding itself, not fixing anything.",
    },
    {
      name: "propose_change",
      title: "Propose a repo change",
      what: "a documentation or SRE-as-code change",
      extra:
        "Scope is enforced in code, not requested politely: any path outside the allowlist is "
        + "rejected before a human ever sees the draft.",
    },
  ].map(({ name, title, what, extra }) => ({
    name,
    title,
    description:
      `Draft ${what} for a human to review and approve. This does NOT open a pull request and `
      + "does NOT change the running system — it records a proposal with status 'draft'. A "
      + "reviewer must approve it in the SREonCall console before anything reaches GitHub. "
      + "Every factual claim in the body must cite an evidence id that resolves via "
      + `get_evidence. ${extra}`,
    inputSchema: {
      type: "object",
      properties: {
        incident_id: { ...str, description: "The incident this addresses, e.g. 'INC-1'." },
        title: { ...str, description: "PR title." },
        body: { ...str, description: "PR body: what broke, what this changes, why — with [E#] citations." },
        files: filesSchema,
      },
      required: ["incident_id", "title", "body", "files"],
    },
    handler: ({ incident_id, title: prTitle, body, files }) => {
      const state = store.load();
      const incident = (state.incidents || []).find((i) => i.id === incident_id);
      if (!incident) throw new Error(`no incident with id '${incident_id}'`);
      if (!Array.isArray(files) || !files.length) throw new Error("at least one file is required");

      // Fail closed, before a human sees it — guarantee 4 of sreoncall-ownership. A caller
      // that ignores the schema's constraint must still be unable to touch src/, bin/, or .env.
      const rejected = files.filter((f) => !isAllowedPath(f.path)).map((f) => f.path);
      if (rejected.length) {
        throw new Error(
          `path(s) outside the allowlist: ${rejected.join(", ")}. Allowed prefixes: ${ALLOWED_PREFIXES.join(", ")}`
        );
      }

      // Citations are checked, not trusted. An invented [E#] means the caller fabricated
      // evidence, and that must fail here rather than reach a reviewer looking verified.
      const ledger = new Ledger(state);
      const { unresolved, cited } = ledger.validate(body);
      if (unresolved.length) {
        throw new Error(
          `body cites evidence ids that do not exist: ${unresolved.join(", ")}. Use search_evidence to find real ids.`
        );
      }

      const proposal = draftProposal({
        kind: "github_pr",
        summary: `${prTitle} (via MCP ${name})`,
        payload: {
          incidentId: incident_id,
          service: incident.service,
          branchName: `agent/${incident_id.toLowerCase()}-${slug(prTitle)}`,
          title: prTitle,
          body,
          files,
          citations: cited,
          proposedVia: name,
        },
      });

      log(`${name} drafted ${proposal.id} — ${files.length} file(s), ${cited.length} citation(s), awaiting human approval`);
      return {
        proposal_id: proposal.id,
        status: "draft",
        files: files.map((f) => f.path),
        citations: cited,
        message:
          "Recorded as a draft. Nothing has been pushed. A human must approve it in the "
          + "SREonCall console (Incident desk → the incident's Ownership tab); only then does a "
          + "branch and pull request get opened. There is intentionally no MCP tool to approve "
          + "or apply a proposal.",
      };
    },
  })),
];

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 over stdio
// ---------------------------------------------------------------------------

function handle(request) {
  const { method, params = {}, id } = request;

  if (method === "initialize") {
    return { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO };
  }
  if (method === "ping") return {};
  if (method === "tools/list") {
    return { tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) };
  }
  if (method === "tools/call") {
    const tool = BY_NAME.get(params.name);
    if (!tool) throw new Error(`no such tool: ${params.name}`);
    // MCP convention: a tool's own failure is a result with isError, not a protocol error —
    // it is feedback the calling model can read and correct, which is exactly what a rejected
    // path or an invented citation should be.
    try {
      const result = tool.handler(params.arguments || {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      log(`${params.name} refused — ${err.message}`);
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  }
  if (id === undefined) return null; // a notification we don't act on
  throw new Error(`unsupported method: ${method}`);
}

function serve(input = process.stdin, output = process.stdout) {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let request;
      try {
        request = JSON.parse(line);
      } catch {
        log("dropped a frame — not valid JSON");
        continue;
      }

      let response;
      try {
        const result = handle(request);
        if (request.id === undefined || result === null) continue; // notification
        response = { jsonrpc: "2.0", id: request.id, result };
      } catch (err) {
        if (request.id === undefined) continue;
        response = { jsonrpc: "2.0", id: request.id, error: { code: -32603, message: err.message } };
      }
      output.write(`${JSON.stringify(response)}\n`);
    }
  });
}

if (require.main === module) {
  log(`serving ${TOOLS.length} tools over stdio — read tools query live state, propose_* tools draft only`);
  serve();
}

module.exports = { TOOLS, handle, serve, SERVER_INFO };
