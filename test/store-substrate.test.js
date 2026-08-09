// The storage substrate.
//
// The state moved from one JSON file to SQLite, and the callers did not change: they still get
// a plain object out of load(), mutate it, and hand it back. These tests hold that promise, and
// the two invariants the move introduced:
//
//   1. Evidence is append-only. load() hands out most entries WITHOUT their raw body, so a
//      substrate that wrote entries back would replace real recorded responses with nothing —
//      citations that used to resolve would quietly stop resolving. That is the worst failure
//      this codebase has, so it gets the most direct test.
//   2. A failed update changes nothing. The old file store could leave a partially applied
//      sweep behind; a transaction must not.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sre-store-"));
process.env.SRE_STATE_PATH = path.join(DIR, "state.json");
process.env.SRE_HYDRATE_METRIC_RAW = "3";

const store = require("../src/store/state");

function reset() {
  store.save({ incidents: [], evidence: [], proposals: [], emergingRisks: [], installs: [], traces: [] });
}

function evidenceEntry(id, kind = "metric", raw = { data: { result: [{ value: [1, "0.5"] }] } }) {
  return { id, kind, query: `q-${id}`, summary: `s-${id}`, target: null, at: "2026-08-09T00:00:00Z", raw };
}

// --- the caller-facing promise ------------------------------------------------------------

test("load returns the same plain shape callers have always mutated", () => {
  reset();
  const state = store.load();
  for (const field of ["incidents", "evidence", "installs", "traces", "emergingRisks"]) {
    assert.ok(Array.isArray(state[field]), `${field} must still be an array`);
  }
  assert.equal(state.lastSweep, null);
});

test("a mutation inside update is persisted and visible to the next reader", () => {
  reset();
  store.update((s) => {
    s.incidents.push({ id: "INC-1", status: "open", service: "checkout" });
    s.lastSweep = "2026-08-09T10:00:00Z";
    s.health = { reachable: true, services: [{ service: "checkout", status: "reporting" }] };
  });

  const state = store.load();
  assert.equal(state.incidents.length, 1);
  assert.equal(state.incidents[0].service, "checkout");
  assert.equal(state.lastSweep, "2026-08-09T10:00:00Z");
  assert.equal(state.health.services[0].status, "reporting", "nested objects survive the round trip");
});

test("mutating a record in place updates it rather than duplicating it", () => {
  reset();
  store.update((s) => s.incidents.push({ id: "INC-1", status: "open" }));
  store.update((s) => {
    s.incidents.find((i) => i.id === "INC-1").status = "resolved";
  });

  const { incidents } = store.load();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].status, "resolved");
});

test("order is preserved — incident ids are derived from array length", () => {
  reset();
  for (let i = 1; i <= 4; i += 1) store.update((s) => s.incidents.push({ id: `INC-${i}`, status: "open" }));
  assert.deepEqual(store.load().incidents.map((i) => i.id), ["INC-1", "INC-2", "INC-3", "INC-4"]);
  assert.equal(store.newIncident({ service: "payment" }).id, "INC-5");
});

test("a removed record is really gone, not resurrected from a stale row", () => {
  reset();
  store.update((s) => {
    s.installs = [{ service: "a" }, { service: "b" }];
  });
  store.update((s) => {
    s.installs = s.installs.filter((r) => r.service !== "a");
  });
  assert.deepEqual(store.load().installs, [{ service: "b" }]);
});

// --- invariant 1: evidence is append-only --------------------------------------------------

test("a recorded body always resolves in full, however long ago it was recorded", () => {
  reset();
  store.update((s) => {
    for (let i = 1; i <= 20; i += 1) s.evidence.push(evidenceEntry(`E${i}`));
  });

  // Well outside the hydrated window (set to 3 for this run).
  const old = store.getEvidence("E1");
  assert.ok(old, "E1 must still resolve");
  assert.deepEqual(old.raw, evidenceEntry("E1").raw, "the body a citation points at must come back whole");
});

test("entries outside the hydrated window declare their body rather than appearing bodiless", () => {
  reset();
  store.update((s) => {
    for (let i = 1; i <= 10; i += 1) s.evidence.push(evidenceEntry(`E${i}`));
  });

  const { evidence } = store.load();
  assert.equal(evidence.length, 10);
  assert.equal(evidence[0].raw, undefined, "an old entry is not hydrated");
  assert.equal(evidence[0].rawAvailable, true, "but it says a body exists");
  assert.ok(evidence[9].raw, "the newest entries keep their bodies for the charts");
  assert.equal(evidence[0].query, "q-E1", "metadata is always present — it is what makes a citation checkable");
});

test("writing back a state whose bodies were never hydrated does not erase them", () => {
  reset();
  store.update((s) => {
    for (let i = 1; i <= 10; i += 1) s.evidence.push(evidenceEntry(`E${i}`));
  });

  // Exactly what every caller does: load (most bodies withheld), change something unrelated,
  // write. The bodies must survive it.
  store.update((s) => {
    s.lastSweep = "2026-08-09T11:00:00Z";
  });

  for (let i = 1; i <= 10; i += 1) {
    assert.ok(store.getEvidence(`E${i}`).raw, `E${i} lost its body on an unrelated write`);
  }
});

test("appending evidence adds to the ledger instead of replacing it", () => {
  reset();
  store.update((s) => s.evidence.push(evidenceEntry("E1")));
  store.update((s) => s.evidence.push(evidenceEntry("E2", "log", { lines: ["boom"] })));

  const { evidence } = store.load();
  assert.deepEqual(evidence.map((e) => e.id), ["E1", "E2"]);
  assert.deepEqual(store.getEvidence("E2").raw, { lines: ["boom"] });
});

test("an entry recorded without a body is not later claimed to have one", () => {
  reset();
  store.update((s) => s.evidence.push({ id: "E1", kind: "log", query: "q", summary: "s", at: "2026-08-09T00:00:00Z" }));
  const [entry] = store.load().evidence;
  assert.equal(entry.rawAvailable, undefined);
  assert.equal(store.getEvidence("E1").raw, undefined);
});

test("an unknown evidence id resolves to null, never to a fabricated record", () => {
  reset();
  assert.equal(store.getEvidence("E999"), null);
});

// --- invariant 2: a failed update leaves nothing behind -------------------------------------

test("a callback that throws rolls the whole update back", () => {
  reset();
  store.update((s) => s.incidents.push({ id: "INC-1", status: "open" }));

  assert.throws(() => store.update((s) => {
    s.incidents.push({ id: "INC-2", status: "open" });
    s.evidence.push(evidenceEntry("E1"));
    throw new Error("investigation failed halfway");
  }), /investigation failed halfway/);

  const state = store.load();
  assert.deepEqual(state.incidents.map((i) => i.id), ["INC-1"], "a half-applied sweep must not persist");
  assert.equal(state.evidence.length, 0);
});

test("the lock is released after a failed update, so the next writer is not wedged", () => {
  reset();
  assert.throws(() => store.update(() => { throw new Error("boom"); }));
  store.update((s) => s.incidents.push({ id: "INC-1", status: "open" }));
  assert.equal(store.load().incidents.length, 1);
});

// --- the plain-text property the JSON file gave for free ------------------------------------

test("exportAll reproduces the whole state, bodies included", () => {
  reset();
  store.update((s) => {
    s.incidents.push({ id: "INC-1", status: "open", service: "checkout" });
    for (let i = 1; i <= 10; i += 1) s.evidence.push(evidenceEntry(`E${i}`));
  });

  const exported = store.exportAll();
  assert.equal(exported.incidents.length, 1);
  assert.equal(exported.evidence.length, 10);
  for (const entry of exported.evidence) {
    assert.ok(entry.raw, `${entry.id} must carry its body in an export`);
  }
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(exported)), "an export must be plain JSON");
});
