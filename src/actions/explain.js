// Translates the fleet's raw readings into something a non-engineer can act on.
//
// The console's readers are not all SREs. A founder, a support lead, or an on-call manager
// needs to look at this and know whether things are fine — and "error_ratio 0.247" does not
// tell them that. "Checkout is failing about one in four requests" does.
//
// This is a genuine reasoning step, not a template. Deciding which of eighteen services is
// worth mentioning, what the right comparison is, and whether a reading is even conclusive
// yet ("too little traffic to tell") is judgement over the numbers. There is no if/else
// mapping from status to sentence anywhere in this file — delete the chat() call and there is
// no summary at all, only the raw rates the UI already had.
//
// Hard rule, enforced in the prompt: it may only describe what the probe measured. It cannot
// diagnose, speculate about causes, or recommend actions — that is the investigator's job,
// downstream, with tools and citations. A summariser that starts guessing at root causes
// produces confident prose with nothing behind it, which is worse than no summary.

"use strict";

const { chat, MODELS } = require("../llm/client");

const SYSTEM_PROMPT = `
You write the one-paragraph plain-language status of a microservices fleet for someone who is
NOT an engineer — imagine a support lead or a founder reading a wall display.

## What you are given

A live probe of every service: whether it is reporting telemetry at all, its request rate per
second, and its error rate per second. Plus the list of incidents the SRE agent currently has
open.

## How to write

- Lead with the verdict, in one short sentence. "Most of the shop is healthy, but checkout is
  failing." Someone reading only the first sentence should know whether to worry.
- Then at most three more sentences naming what specifically is wrong and how badly.
- Translate every number into something a person feels. "About one in four checkout requests
  is failing" beats "error ratio 0.247". "Has stopped reporting entirely" beats "no series".
- Name services in plain words where you can: "the checkout service", "the payments service".
- If a service has almost no traffic, say the reading is inconclusive rather than implying a
  problem. Very low request rates make error ratios meaningless, and claiming otherwise would
  frighten a reader for no reason.
- No jargon: no PromQL, no metric names, no "p95", no "span", no "series".

## What you must NOT do

- Do not diagnose a cause. You are reporting what is measured, not why. "Checkout is failing"
  is yours to say; "because of a DNS problem" is not — that belongs to the investigation.
- Do not recommend actions.
- Do not invent a number you were not given, and do not round a number into a different
  meaning.
- Do not describe the fleet as healthy if any service has stopped reporting. A service that
  went silent is the most serious state here, not the least — it means nobody can see it.

Write only the paragraph. No heading, no bullets, no preamble.
`.trim();

function describeFleet(health, incidents) {
  const lines = [];

  if (!health?.reachable) {
    lines.push("PROBE FAILED — the metrics backend could not be reached, so no service readings exist.");
    if (health?.error) lines.push(`Reason: ${health.error}`);
    return lines.join("\n");
  }

  lines.push("Per-service readings (requests/sec and errors/sec, last 5 minutes):");
  for (const s of health.services || []) {
    if (s.status === "silent") {
      lines.push(`- ${s.service}: NOT REPORTING — no telemetry at all`);
    } else if (s.status === "unknown") {
      lines.push(`- ${s.service}: unknown, probe could not read it`);
    } else {
      const ratio = s.callRate > 0 ? (s.errorRate / s.callRate) : 0;
      lines.push(
        `- ${s.service}: ${s.callRate.toFixed(3)} req/s, ${s.errorRate.toFixed(3)} err/s` +
          (s.callRate > 0 ? ` (${(ratio * 100).toFixed(1)}% of requests failing)` : " (no traffic)")
      );
    }
  }

  const open = (incidents || []).filter((i) => !["resolved", "closed", "mitigated"].includes(i.status));
  lines.push("", `The SRE agent currently has ${open.length} open incident(s):`);
  for (const inc of open.slice(0, 12)) {
    lines.push(`- ${inc.id} on ${inc.service} (confidence ${inc.confidence}): ${String(inc.headline).slice(0, 160)}`);
  }

  return lines.join("\n");
}

/**
 * Produces `{ text, at }` — the plain-language fleet status.
 *
 * Returns `null` rather than throwing if the model call fails. This is a presentation aid
 * layered over readings the dashboard already renders numerically; losing it must degrade the
 * board to "numbers without a sentence", never take the sweep down.
 */
async function explainFleet({ health, incidents, model = MODELS.fast } = {}) {
  try {
    const reply = await chat({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: describeFleet(health, incidents) }],
    });
    const text = (reply.text || "").trim();
    if (!text) return null;
    return { text, at: new Date().toISOString() };
  } catch {
    return null;
  }
}

module.exports = { explainFleet, describeFleet };
