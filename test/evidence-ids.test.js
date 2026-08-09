// Evidence ids, and why they are not the array's length.
//
// Found in the live ledger during the move to SQLite: two entirely different PromQL queries had
// both been recorded as E88. `E${evidence.length + 1}` produces that whenever two entries are
// appended in one pass from different code paths — and a duplicate id is an auditability hole,
// not a cosmetic one. Everything this agent claims is checkable only because [E#] resolves to
// the one query behind it. A citation that resolves to whichever of two rows is found first is
// a claim nobody can verify.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.SRE_STATE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sre-ids-")), "state.json");

const { nextId, Ledger } = require("../src/evidence/ledger");
const store = require("../src/store/state");

test("ids continue from the highest already issued", () => {
  assert.equal(nextId([]), "E1");
  assert.equal(nextId([{ id: "E1" }, { id: "E2" }]), "E3");
});

test("a gap in the numbering does not cause a reuse", () => {
  // The exact shape that produced the live collision: fewer entries than the highest id.
  assert.equal(nextId([{ id: "E1" }, { id: "E88" }]), "E89", "length would have said E3 — which E88 already is");
});

test("out-of-order entries still yield an unused id", () => {
  assert.equal(nextId([{ id: "E9" }, { id: "E3" }, { id: "E7" }]), "E10");
});

test("a malformed or missing id never derails the sequence", () => {
  assert.equal(nextId([{ id: "E4" }, {}, { id: null }, { id: "not-an-id" }]), "E5");
});

test("recording repeatedly never issues the same id twice", () => {
  store.save({ incidents: [], evidence: [], proposals: [] });
  const ledger = new Ledger();
  const ids = [];
  for (let i = 0; i < 25; i += 1) {
    ids.push(ledger.record({ kind: "metric", query: `q${i}`, raw: { i }, summary: `s${i}` }).id);
  }
  assert.equal(new Set(ids).size, 25, "every recorded query must be independently citable");
});

test("every recorded id resolves back to its own query, not a neighbour's", () => {
  store.save({ incidents: [], evidence: [], proposals: [] });
  const ledger = new Ledger();
  const a = ledger.record({ kind: "metric", query: "rate(errors)", raw: { a: 1 }, summary: "errors" });
  const b = ledger.record({ kind: "metric", query: "rate(calls)", raw: { b: 2 }, summary: "calls" });

  assert.notEqual(a.id, b.id);
  assert.equal(ledger.get(a.id).query, "rate(errors)");
  assert.equal(ledger.get(b.id).query, "rate(calls)");
  assert.deepEqual(ledger.get(b.id).raw, { b: 2 }, "resolving a citation returns the body it was recorded with");
});

test("validate still refuses a citation that was never recorded", () => {
  store.save({ incidents: [], evidence: [], proposals: [] });
  const ledger = new Ledger();
  const { id } = ledger.record({ kind: "metric", query: "up", raw: {}, summary: "up" });

  assert.equal(ledger.validate(`fine [${id}]`).ok, true);
  const bad = ledger.validate(`invented [${id}] and [E4242]`);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unresolved, ["E4242"]);
});
