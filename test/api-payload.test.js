// The /api/state wire contract.
//
// The dashboard polls this endpoint continuously, and the evidence ledger is append-only, so
// the payload grows forever unless something bounds it. The rule being tested is narrow and
// deliberate: the TRANSPORT may drop raw response bodies the dashboard never reads inline —
// the RECORD may not lose anything. An entry whose body was left out must say so, and must
// still resolve in full through /api/evidence/:id.
//
// The reason this has a test rather than a comment: "trim the payload" is one careless edit
// away from "trim what the agent can see", and those two look identical in a diff.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.SRE_STATE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sre-api-")), "state.json");

const { trimEvidenceForWire, INLINE_METRIC_RAW } = require("../src/web/server");

function entry(id, kind, raw) {
  return { id, kind, query: `q-${id}`, summary: `s-${id}`, at: "2026-08-09T00:00:00Z", target: null, raw };
}

const bigBody = { data: { result: [{ values: Array.from({ length: 200 }, (_, i) => [i, `line ${i}`]) }] } };
const metricBody = { data: { result: [{ value: [1754700000, "0.42"] }] } };

test("recent metric bodies stay inline — the dashboard's trend charts read them directly", () => {
  const wire = trimEvidenceForWire([entry("E1", "metric", metricBody)]);
  assert.deepEqual(wire[0].raw, metricBody, "a recent metric reading must keep its vector");
  assert.equal(wire[0].rawAvailable, undefined, "nothing was withheld, so nothing to flag");
});

test("log and trace bodies are withheld from the wire and flagged as fetchable", () => {
  const wire = trimEvidenceForWire([entry("E1", "log", bigBody), entry("E2", "trace", bigBody)]);
  for (const item of wire) {
    assert.equal(item.raw, undefined, `${item.id} should not ship its body`);
    assert.equal(item.rawAvailable, true, `${item.id} must declare that a body exists`);
  }
});

test("nothing but the raw body is ever dropped — the record itself stays whole", () => {
  const [wire] = trimEvidenceForWire([entry("E1", "trace", bigBody)]);
  for (const field of ["id", "kind", "query", "summary", "at"]) {
    assert.ok(field in wire, `${field} must survive trimming — it is what makes a citation checkable`);
  }
  assert.equal(wire.query, "q-E1");
});

test("older metric bodies fall out of the inline window but are never silently blanked", () => {
  const evidence = Array.from({ length: INLINE_METRIC_RAW + 5 }, (_, i) => entry(`E${i}`, "metric", metricBody));
  const wire = trimEvidenceForWire(evidence);

  assert.equal(wire[0].raw, undefined, "the oldest entry is past the inline window");
  assert.equal(wire[0].rawAvailable, true, "and it says so, rather than looking like it had no body");
  assert.deepEqual(wire[wire.length - 1].raw, metricBody, "the newest entry always keeps its body");
});

test("an entry that genuinely has no body is not mislabelled as having one", () => {
  const [wire] = trimEvidenceForWire([entry("E1", "log", null)]);
  assert.equal(wire.rawAvailable, undefined, "rawAvailable must mean 'fetch it', not 'it might exist'");
});

test("trimming measurably shrinks the payload", () => {
  const evidence = Array.from({ length: 300 }, (_, i) => entry(`E${i}`, "trace", bigBody));
  const before = JSON.stringify(evidence).length;
  const after = JSON.stringify(trimEvidenceForWire(evidence)).length;
  assert.ok(after < before / 10, `expected a large reduction, got ${before} -> ${after}`);
});
