"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateTrail, deriveConfidence } = require("../src/investigator/policy");

const hypothesis = (status, text = status.toLowerCase()) => ({ status, text });

test("an empty trail is explicitly undisciplined and low confidence", () => {
  assert.deepEqual(evaluateTrail([]), {
    disciplined: false,
    reason: "no hypothesis was ever stated",
  });
  assert.deepEqual(deriveConfidence([]), {
    level: "low",
    capped: false,
    policy: {
      disciplined: false,
      reason: "no hypothesis was ever stated",
    },
  });
});

test("first-turn confirmation is capped because no disconfirmation attempt was recorded", () => {
  const verdict = deriveConfidence([hypothesis("CONFIRMED")]);

  assert.equal(verdict.level, "medium");
  assert.equal(verdict.capped, true);
  assert.equal(verdict.policy.disciplined, false);
  assert.match(verdict.policy.reason, /confirmed on the first tag/i);
});

test("confirmation after a follow-up turn earns high confidence", () => {
  const trail = [hypothesis("NEW"), hypothesis("CONFIRMED")];
  const verdict = deriveConfidence(trail);

  assert.equal(verdict.level, "high");
  assert.equal(verdict.capped, false);
  assert.equal(verdict.policy.disciplined, true);
});

test("revision without prior disconfirmation is rejected by the policy", () => {
  const trail = [hypothesis("NEW"), hypothesis("REVISED")];
  const policy = evaluateTrail(trail);

  assert.equal(policy.disciplined, false);
  assert.match(policy.reason, /no disconfirmed tag/i);
  assert.equal(deriveConfidence(trail).level, "medium");
});

test("revision following explicit disconfirmation is disciplined", () => {
  const trail = [
    hypothesis("NEW"),
    hypothesis("DISCONFIRMED"),
    hypothesis("REVISED"),
  ];
  const verdict = deriveConfidence(trail);

  assert.equal(verdict.level, "medium");
  assert.equal(verdict.capped, false);
  assert.equal(verdict.policy.disciplined, true);
});

test("an investigation ending in disconfirmation remains honest and low confidence", () => {
  const trail = [hypothesis("NEW"), hypothesis("DISCONFIRMED")];
  const verdict = deriveConfidence(trail);

  assert.equal(verdict.level, "low");
  assert.equal(verdict.capped, false);
  assert.equal(verdict.policy.disciplined, true);
});

test("a new unresolved hypothesis remains medium confidence without being penalized", () => {
  const verdict = deriveConfidence([hypothesis("NEW")]);

  assert.equal(verdict.level, "medium");
  assert.equal(verdict.capped, false);
  assert.equal(verdict.policy.disciplined, true);
});
