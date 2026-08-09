// The ownership guarantees, as executable assertions rather than prose in a skill file.
//
// These are safety properties, not preferences: each test here corresponds to a numbered
// guarantee in .claude/skills/sreoncall-ownership. If one of them starts failing, the agent
// has gained the ability to publish something a human never approved, or to write outside the
// scope it is allowed to touch. That is the failure mode this file exists to make loud.
//
// Everything runs against a throwaway state file (SRE_STATE_PATH) so the live agent's memory
// is never touched — including its lockfile, which the real read-modify-write path takes.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STATE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sre-test-")), "state.json");
process.env.SRE_STATE_PATH = STATE_PATH;

const store = require("../src/store/state");
const { draftProposal, approveProposal, applyGithubPrProposal } = require("../src/actions/proposals");
const { isAllowedPath, ALLOWED_PREFIXES } = require("../src/actions/remediation");
const mcp = require("../src/mcp/server");

function seed(state) {
  store.save({
    incidents: [],
    evidence: [],
    installs: [],
    traces: [],
    lastSweep: null,
    emergingRisks: [],
    proposals: [],
    ...state,
  });
}

function callTool(name, args) {
  const result = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return { isError: Boolean(result.isError), text: result.content[0].text };
}

// --- guarantee 4: scope is enforced in code, not requested in the prompt -----------------

test("the path allowlist accepts the two directories the agent owns", () => {
  assert.deepEqual(ALLOWED_PREFIXES, ["sre-as-code/", "docs/incidents/"]);
  assert.ok(isAllowedPath("sre-as-code/alert-rules/checkout.yaml"));
  assert.ok(isAllowedPath("docs/incidents/inc-1.md"));
  assert.ok(isAllowedPath("./sre-as-code/runbooks/dns.yaml"), "a leading ./ is normalised, not rejected");
});

test("the path allowlist fails closed on the agent's own senses, secrets, and traversal", () => {
  for (const forbidden of [
    "src/lgtm/client.js",       // its own observability pipeline
    "src/sentinel/daemon.js",
    "bin/sre",
    ".env",                      // its own credentials
    "package.json",
    "sre-as-code/../src/llm/client.js",
    "docs/incidents/../../.env",
  ]) {
    assert.equal(isAllowedPath(forbidden), false, `${forbidden} must be rejected`);
  }
});

// --- guarantee 3: publishing requires an explicit approval transition --------------------

test("applying a draft proposal throws — approval is a precondition, not a label", async () => {
  seed({});
  const proposal = draftProposal({ kind: "github_pr", summary: "s", payload: { files: [] } });
  assert.equal(proposal.status, "draft");

  await assert.rejects(
    () => applyGithubPrProposal(proposal, { owner: "o", repo: "r", token: "t" }),
    /must be 'approved'/,
    "a draft must never reach GitHub"
  );
});

test("applying a rejected proposal throws — a human's refusal cannot be reversed by retrying", async () => {
  seed({});
  const proposal = draftProposal({ kind: "github_pr", summary: "s", payload: { files: [] } });
  store.update((s) => {
    s.proposals[0].status = "rejected";
    s.proposals[0].rejectionReason = "not worth a repo change";
  });

  await assert.rejects(
    () => applyGithubPrProposal({ ...proposal, status: "rejected" }, { owner: "o", repo: "r", token: "t" }),
    /must be 'approved'/
  );
});

test("approve records the transition and the time it happened", () => {
  seed({});
  const proposal = draftProposal({ kind: "github_pr", summary: "s", payload: { files: [] } });
  const approved = approveProposal(proposal.id);
  assert.equal(approved.status, "approved");
  assert.ok(Date.parse(approved.approvedAt), "an approval with no timestamp is not auditable");
  assert.equal(store.load().proposals[0].status, "approved", "the transition is persisted, not in-memory only");
});

test("approving an unknown proposal throws rather than silently creating one", () => {
  seed({});
  assert.throws(() => approveProposal("P404"), /No proposal found/);
});

// --- the MCP surface: same guarantees, now reachable by any model client ------------------

test("the MCP server exposes no tool that approves, applies, or writes to the fleet", () => {
  const names = mcp.TOOLS.map((t) => t.name);
  for (const forbidden of ["approve_proposal", "apply_proposal", "merge_pr", "restart_service", "mute_alert", "delete_alert_rule"]) {
    assert.equal(names.includes(forbidden), false, `${forbidden} must not exist`);
  }
  assert.ok(names.includes("propose_change"), "drafting is the whole point");
  assert.ok(names.includes("get_evidence"), "a citation must be resolvable by the caller too");
});

test("every MCP tool advertises a name, description, and input schema", () => {
  const { tools } = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.ok(tools.length >= 8);
  for (const tool of tools) {
    assert.ok(tool.name && tool.description, `${tool.name} needs a description`);
    assert.equal(tool.inputSchema.type, "object");
  }
});

test("an MCP propose call is refused when a file falls outside the allowlist", () => {
  seed({ incidents: [{ id: "INC-1", service: "checkout", status: "open" }] });
  const { isError, text } = callTool("propose_change", {
    incident_id: "INC-1",
    title: "Disable the noisy collector",
    body: "No citations needed for this test.",
    files: [{ path: "src/lgtm/client.js", content: "// blinded" }],
  });
  assert.ok(isError, "an out-of-scope path must be refused");
  assert.match(text, /outside the allowlist/);
  assert.equal(store.load().proposals.length, 0, "nothing may be recorded when the scope check fails");
});

test("an MCP propose call is refused when it cites evidence that does not exist", () => {
  seed({
    incidents: [{ id: "INC-1", service: "checkout", status: "open" }],
    evidence: [{ id: "E1", kind: "metric", query: "up", summary: "checkout up", at: "2026-08-09T00:00:00Z", raw: {} }],
  });
  const { isError, text } = callTool("propose_alert_rule", {
    incident_id: "INC-1",
    title: "Alert on checkout errors",
    body: "Checkout error rate rose sharply [E1] and payment stopped responding [E999].",
    files: [{ path: "sre-as-code/alert-rules/checkout.yaml", content: "rules: []" }],
  });
  assert.ok(isError, "an invented citation must be refused, not warned about");
  assert.match(text, /E999/);
  assert.equal(store.load().proposals.length, 0);
});

test("a valid MCP propose call lands as a draft — never as an applied change", () => {
  seed({
    incidents: [{ id: "INC-1", service: "checkout", status: "open" }],
    evidence: [{ id: "E1", kind: "metric", query: "up", summary: "checkout up", at: "2026-08-09T00:00:00Z", raw: {} }],
  });
  const { isError, text } = callTool("propose_runbook", {
    incident_id: "INC-1",
    title: "Checkout to payment DNS failures",
    body: "Checkout's calls to payment fail DNS resolution [E1].",
    files: [{ path: "sre-as-code/runbooks/checkout-dns.yaml", content: "steps: []" }],
  });
  assert.equal(isError, false, text);

  const result = JSON.parse(text);
  assert.equal(result.status, "draft");
  assert.deepEqual(result.citations, ["E1"]);

  const [stored] = store.load().proposals;
  assert.equal(stored.status, "draft", "an MCP caller must not be able to skip the human gate");
  assert.equal(stored.payload.proposedVia, "propose_runbook", "the origin of a proposal stays auditable");
  assert.match(stored.payload.branchName, /^agent\/inc-1-/, "never the default branch");
});

// An unknown tool is a protocol-level error (a client asked for something that does not
// exist), not a tool result — unlike a refused path or an invented citation, which ARE tool
// results because they are feedback the calling model can act on.
test("an unknown tool is refused rather than silently ignored", () => {
  assert.throws(
    () => mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_everything" } }),
    /no such tool/
  );
});
