// Finishing the agent's own unfinished work.
//
// An incident with a concluded RCA and no remediation outcome is a diagnosis nobody ever
// decided what to do about. It happens for real reasons — a process death between
// investigating and deciding, a failed draft call, an incident opened before the remediation
// path was wired into the loop — and nothing used to revisit it, so it sat open forever.
//
// What these tests police is the selection, because that is where this goes wrong: too eager
// and the agent re-decides settled incidents in a loop; too narrow and the backlog never
// drains. The decision itself stays the model's, made through the same path a fresh incident
// takes.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.SRE_STATE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sre-stalled-")), "state.json");

const { stalledIncidents, RESUME_PER_SWEEP } = require("../src/sentinel/daemon");

const RCA = "checkout — DNS resolution failures [E1]";

test("an open incident that concluded but never decided is stalled", () => {
  const stalled = stalledIncidents({ incidents: [{ id: "INC-1", status: "open", rca: RCA }] });
  assert.deepEqual(stalled.map((i) => i.id), ["INC-1"]);
});

test("an incident that already reached a decision is left alone", () => {
  const incidents = [
    { id: "INC-1", status: "open", rca: RCA, remediation: { kind: "github_pr", proposalId: "P1" } },
    { id: "INC-2", status: "open", rca: RCA, remediation: { kind: "no_code_fix", reason: "operator action" } },
    { id: "INC-3", status: "open", rca: RCA, remediation: { kind: "reused", fromIncident: "INC-1" } },
  ];
  assert.deepEqual(stalledIncidents({ incidents }), [], "a decline and a reuse are outcomes, not gaps");
});

test("a recorded failure counts as decided — retrying it every sweep would be a blind retry loop", () => {
  const incidents = [{ id: "INC-1", status: "open", rca: RCA, remediation: { kind: "failed", error: "model unavailable" } }];
  assert.deepEqual(stalledIncidents({ incidents }), []);
});

test("an incident still being investigated is not stalled — there is nothing to decide on yet", () => {
  const incidents = [{ id: "INC-1", status: "open" }, { id: "INC-2", status: "open", rca: "" }];
  assert.deepEqual(stalledIncidents({ incidents }), []);
});

test("a closed incident is never reopened for a decision", () => {
  const incidents = [
    { id: "INC-1", status: "resolved", rca: RCA },
    { id: "INC-2", status: "closed", rca: RCA },
    { id: "INC-3", status: "mitigated", rca: RCA },
  ];
  assert.deepEqual(stalledIncidents({ incidents }), [], "finishing work on a closed incident is not initiative");
});

test("an empty or fresh state yields nothing to resume", () => {
  assert.deepEqual(stalledIncidents({}), []);
  assert.deepEqual(stalledIncidents({ incidents: [] }), []);
});

test("the per-sweep bound leaves the rest of the backlog for later sweeps", () => {
  const incidents = Array.from({ length: 9 }, (_, i) => ({ id: `INC-${i + 1}`, status: "open", rca: RCA }));
  const stalled = stalledIncidents({ incidents });

  assert.equal(stalled.length, 9, "selection itself is not truncated — the caller bounds the work");
  assert.ok(RESUME_PER_SWEEP > 0 && RESUME_PER_SWEEP < stalled.length,
    "the bound must actually bound something, or fresh detection starves behind the backlog");
  assert.deepEqual(stalled.slice(0, RESUME_PER_SWEEP).map((i) => i.id), ["INC-1", "INC-2"],
    "oldest first — the incident that has waited longest gets decided first");
});
