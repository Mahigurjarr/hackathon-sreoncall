// What the model wrote vs. what a human reads.
//
// The RCA's first block is stored verbatim as the incident headline, and that stored string
// travels: into the recall prompt, into the PR body, into MCP list_incidents, into the
// copilot's grounding packet. So the prompt's own scaffolding ("Headline: - checkout — ...")
// leaking into it is not a cosmetic issue — it is a reviewer opening a pull request titled
// "Headline: Headline: - checkout".
//
// The line these tests police: strip the LABEL the prompt asked for, never the CONTENT the
// model produced. A stripper that eats a real word is worse than the seam it fixed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { extractHeadline, extractResolutionSteps } = require("../src/sentinel/daemon");

test("the headline is the RCA's first block, whitespace-normalised", () => {
  const rca = "checkout — its gRPC call to payment\nfails DNS resolution [E110].\n\nEvidence: ...";
  assert.equal(extractHeadline(rca), "checkout — its gRPC call to payment fails DNS resolution [E110].");
});

test("the prompt's own 'Headline:' label is stripped, in every shape the model writes it", () => {
  const cases = [
    "Headline: checkout — DNS resolution fails [E1]",
    "Headline: - checkout — DNS resolution fails [E1]",
    "- Headline: checkout — DNS resolution fails [E1]",
    "Headline - checkout — DNS resolution fails [E1]",
    "**Headline:** checkout — DNS resolution fails [E1]",
    "headline: checkout — DNS resolution fails [E1]",
  ];
  for (const rca of cases) {
    assert.equal(extractHeadline(rca), "checkout — DNS resolution fails [E1]", `not stripped: ${rca}`);
  }
});

test("a service or sentence that merely begins with a word is left alone", () => {
  assert.equal(
    extractHeadline("headline-service — is erroring [E1]"),
    "headline-service — is erroring [E1]",
    "the label only ends at a colon or dash separator, so a real name survives"
  );
  assert.equal(extractHeadline("payment — headline: not a label here [E1]"), "payment — headline: not a label here [E1]");
});

test("the citation in a headline survives stripping — it is what makes it checkable", () => {
  assert.match(extractHeadline("Headline: - ad — error ratio rose [E42][E43]"), /\[E42\]\[E43\]/);
});

test("a headline is bounded so it cannot become the whole RCA", () => {
  assert.ok(extractHeadline("Headline: " + "x".repeat(500)).length <= 220);
});

test("next steps are only real ordinal lines, not the heading's own parenthetical", () => {
  const rca = [
    "checkout — DNS failures [E1]",
    "",
    "Recommended next steps (tied to the evidence):",
    "1. Validate DNS resolution from a checkout pod [E1]",
    "2. Check cluster DNS health [E2]",
    "Happy to dig further if useful.",
  ].join("\n");

  assert.deepEqual(extractResolutionSteps(rca), [
    "Validate DNS resolution from a checkout pod [E1]",
    "Check cluster DNS health [E2]",
  ]);
});

test("an RCA with no recommended steps yields none rather than inventing one", () => {
  assert.deepEqual(extractResolutionSteps("checkout — DNS failures [E1]\n\nEvidence: ..."), []);
});
