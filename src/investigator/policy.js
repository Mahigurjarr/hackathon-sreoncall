// The explicit policy layer malleability was missing — until now, "the reasoning is adaptive"
// rested entirely on the model choosing to follow the prompt's hypothesis discipline
// (sre-as-code/practices/incident-response.md: state it, try to break it, only then confirm or
// revise) and on nothing else checking whether it actually did. A model under pressure can
// self-report CONFIRMED on the very first thing it thought of; the prompt asking it not to is
// a convention, not a guarantee.
//
// This is deterministic code, and correctly so — see sreoncall-ai-native-gate: this makes no
// claim about the WORLD (it doesn't decide anything is anomalous or root-caused), it only
// checks the SHAPE of a self-report the model already produced. That distinction is what keeps
// this from being the kind of non-AI fallback the gate forbids: it downgrades trust in an
// unearned claim, it never manufactures a diagnosis.

"use strict";

/**
 * Judges whether a hypothesis trail actually earned the confidence its last tag claims.
 *
 * Returns `{ disciplined, reason }`:
 * - CONFIRMED as the only entry (no prior NEW/DISCONFIRMED turns) means it was declared, not
 *   tested — the model never gave itself a chance to be wrong before calling it settled.
 * - REVISED with no DISCONFIRMED anywhere earlier in the trail means the "revision" wasn't a
 *   response to contradicting evidence — it's just a second guess with no disconfirmation
 *   behind it, which the practice doc's discipline explicitly requires.
 * - Anything else (NEW, DISCONFIRMED as the final word, or a properly earned CONFIRMED/REVISED)
 *   is disciplined — including ending mid-cycle, which is an honest lower-confidence state, not
 *   a violation of anything.
 */
function evaluateTrail(hypothesisHistory) {
  const trail = hypothesisHistory || [];
  if (!trail.length) {
    return { disciplined: false, reason: "no hypothesis was ever stated" };
  }

  const last = trail[trail.length - 1];
  const hadDisconfirmedTag = trail.some((h) => h.status === "DISCONFIRMED");

  if (last.status === "CONFIRMED") {
    if (trail.length === 1) {
      return { disciplined: false, reason: "confirmed on the first tag — no attempt to disconfirm it was recorded" };
    }
    return { disciplined: true, reason: "confirmed after at least one follow-up turn beyond the initial hypothesis" };
  }

  if (last.status === "REVISED") {
    if (!hadDisconfirmedTag) {
      return { disciplined: false, reason: "revised with no disconfirmed tag earlier in the trail to justify the revision" };
    }
    return { disciplined: true, reason: "revision followed a recorded disconfirmation" };
  }

  return { disciplined: true, reason: `investigation ended on ${last.status} — no confirmation claimed, nothing to police` };
}

/**
 * Confidence, policed against the trail's own discipline rather than trusting the last tag at
 * face value. A CONFIRMED that didn't earn it (see evaluateTrail) is capped at "medium" — still
 * usable, since the model may well be right, but not granted the top confidence level on a
 * self-report the trail itself doesn't support.
 *
 * Returns `{ level, capped, policy }` — `policy` is stored on the incident (`confidencePolicy`)
 * so a reviewer can see WHY a confidence level landed where it did, not just what it landed on.
 */
function deriveConfidence(hypothesisHistory) {
  const trail = hypothesisHistory || [];
  const policy = evaluateTrail(trail);

  if (!trail.length) return { level: "low", capped: false, policy };

  const last = trail[trail.length - 1];
  let level;
  if (last.status === "CONFIRMED") level = policy.disciplined ? "high" : "medium";
  else if (last.status === "DISCONFIRMED") level = "low";
  else level = "medium"; // NEW or REVISED with no further confirming attempt captured

  return { level, capped: last.status === "CONFIRMED" && !policy.disciplined, policy };
}

module.exports = { evaluateTrail, deriveConfidence };
