// Incident memory — the agent learning from what it has already diagnosed.
//
// The problem this solves: the sentinel sweeps every ~45s, and the same underlying fault
// recurs. Re-running a twelve-turn tool loop to rediscover a root cause the agent already
// established, cited, and wrote a runbook for is pure waste — it burns budget that a genuinely
// novel failure needs, and it produces a second incident that says the same thing as the first.
//
// The mechanism is deliberately NOT a string hash or a service-name equality check. Two
// incidents on `checkout` can be a DNS failure and a payment timeout — the same service, an
// entirely different failure mode; while a flagd deadline can surface as an incident on
// `recommendation` one sweep and `payment` the next — different services, the same fault.
// Deciding "is this the same thing?" is a judgement over evidence, so it is made by the model.
// Plain code only narrows the candidate set to keep that judgement cheap.
//
// The saving is real but bounded on purpose: a `reuse` verdict still runs a short, live
// verification investigation (see daemon.js) rather than trusting the recalled diagnosis
// outright. Prior art is a starting point, never a conclusion — sre-as-code/practices/
// incident-response.md says so, and skipping verification would let a stale answer outlive
// the condition that produced it.

"use strict";

const { chat, MODELS } = require("../llm/client");

// How many prior incidents the model is asked to consider. Enough to cover a recurring fault
// and its near neighbours; small enough that recall stays much cheaper than the investigation
// it might replace, which is the entire point.
const MAX_CANDIDATES = 6;

/**
 * Narrows the store's incident history to those worth asking about: anything already
 * diagnosed (it has an RCA), most recent first. Excludes `excludeId` so an incident can
 * never recall itself.
 *
 * No similarity judgement happens here — that is the model's job below. This is a cheap
 * bound on how much history gets sent, nothing more.
 */
function findCandidates(state, { excludeId = null } = {}) {
  return (state.incidents || [])
    .filter((inc) => inc.id !== excludeId && inc.rca && String(inc.rca).trim())
    .slice()
    .reverse()
    .slice(0, MAX_CANDIDATES);
}

function summarizeCandidate(inc, proposals) {
  const proposal = (proposals || []).find((p) => p.payload?.incidentId === inc.id);
  const remediation = inc.remediation?.kind === "no_code_fix"
    ? `declined a repo change — ${inc.remediation.reason}`
    : proposal
      ? `proposed ${proposal.payload.files.length} file change(s) "${proposal.payload.title}" (status: ${proposal.status})`
      : "no remediation recorded";

  return [
    `### ${inc.id} — service: ${inc.service} — confidence: ${inc.confidence} — opened ${inc.openedAt}`,
    `Headline: ${inc.headline}`,
    `Diagnosis: ${String(inc.rca).slice(0, 1200)}`,
    `Remediation: ${remediation}`,
  ].join("\n");
}

const SYSTEM_PROMPT = `
You are the memory of an autonomous SRE agent. Before it spends a full investigation on a new
alert, you decide whether it has already diagnosed this exact failure before.

You are given a new trigger and the agent's own recent, already-diagnosed incidents. Return
one of three verdicts:

- "reuse" — the new trigger is the SAME underlying failure mode as one specific prior
  incident: same mechanism, same causal story, such that the prior diagnosis would be the
  correct answer again. The agent will still run a short live check to confirm the condition
  still holds, so "reuse" means "start from this answer", not "skip looking".

- "related" — a prior incident is genuinely informative (same subsystem, adjacent mechanism,
  a fault previously seen to cascade this way) but is NOT the same failure. The agent will
  investigate fully, with that prior diagnosis as orientation.

- "novel" — nothing in the history meaningfully bears on this trigger. Do not stretch for a
  match; a wrong "reuse" is far more expensive than a missed one, because it makes the agent
  confidently restate an answer to a question nobody asked.

Judge by MECHANISM, not by service name. The same service can fail in unrelated ways, and one
root fault (a flag, a dependency, a collector) can surface on several different services. A
shared service name is weak evidence; a shared causal mechanism is strong evidence.

Be conservative. When the trigger text is too thin to tell the difference between two prior
mechanisms, answer "related" or "novel", never "reuse".
`.trim();

const TOOLS = [
  {
    type: "function",
    function: {
      name: "recall_verdict",
      description: "Report whether this trigger matches a previously diagnosed incident.",
      parameters: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["reuse", "related", "novel"] },
          incidentId: {
            type: "string",
            description: "The prior incident id this refers to, e.g. 'INC-3'. Omit or leave empty for 'novel'.",
          },
          mechanism: {
            type: "string",
            description: "The shared failure mechanism in one sentence, in your own words. Empty for 'novel'.",
          },
          reason: { type: "string", description: "Why this verdict — what made it the same, adjacent, or unrelated." },
        },
        required: ["verdict", "reason"],
      },
    },
  },
];

/**
 * Asks the model whether `trigger` is something the agent has already worked out.
 *
 * Returns `{ verdict, incidentId, mechanism, reason, priorIncident, candidatesConsidered }`.
 * Falls back to a `novel` verdict (never throws) when there is no history to compare against
 * or the recall call itself fails — memory is an optimisation, and losing it must degrade the
 * agent to "investigate everything from scratch", which is exactly its behaviour without this
 * module. It must never block an incident from being investigated at all.
 */
async function recall({ trigger, service, state, model = MODELS.fast } = {}) {
  const candidates = findCandidates(state || {});

  if (!candidates.length) {
    return { verdict: "novel", reason: "no previously diagnosed incidents to compare against", candidatesConsidered: 0 };
  }

  const userMessage = [
    `New trigger: ${trigger}`,
    service ? `Service flagged: ${service}` : "",
    "",
    "## The agent's previously diagnosed incidents",
    candidates.map((inc) => summarizeCandidate(inc, state.proposals)).join("\n\n"),
    "",
    "Give your verdict now.",
  ]
    .filter(Boolean)
    .join("\n");

  let reply;
  try {
    reply = await chat({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: TOOLS,
      toolChoice: "required",
    });
  } catch (err) {
    return {
      verdict: "novel",
      reason: `recall unavailable (${err.message}) — investigating from scratch`,
      candidatesConsidered: candidates.length,
      degraded: true,
    };
  }

  const call = reply.toolCalls[0];
  if (!call || call.name !== "recall_verdict") {
    return {
      verdict: "novel",
      reason: "recall returned no usable verdict — investigating from scratch",
      candidatesConsidered: candidates.length,
      degraded: true,
    };
  }

  const { verdict, incidentId, mechanism, reason } = call.args;
  const priorIncident = incidentId ? candidates.find((inc) => inc.id === incidentId) || null : null;

  // A verdict naming an incident that isn't in the candidate set can't be acted on — treat it
  // as novel rather than silently reusing nothing.
  if ((verdict === "reuse" || verdict === "related") && !priorIncident) {
    return {
      verdict: "novel",
      reason: `recall named '${incidentId || "(none)"}', which is not among the candidates — investigating from scratch`,
      candidatesConsidered: candidates.length,
      degraded: true,
    };
  }

  return {
    verdict: verdict || "novel",
    incidentId: priorIncident?.id || null,
    mechanism: mechanism || null,
    reason: reason || "",
    priorIncident,
    candidatesConsidered: candidates.length,
  };
}

/**
 * Renders a recall result as orientation text for the investigator's frame. Explicitly
 * labelled as prior art rather than evidence: it was not produced by a tool call in the
 * current session, so it is not citable and the investigator is told to verify it.
 */
function priorArtBlock(recallResult) {
  const prior = recallResult?.priorIncident;
  if (!prior) return null;

  const stance =
    recallResult.verdict === "reuse"
      ? "The agent has diagnosed this same failure mechanism before. Start from that answer and " +
        "verify it still holds with your own queries — do not rediscover it from scratch, and do " +
        "not accept it without a live check either."
      : "A previous incident is related but is NOT the same failure. Use it for orientation only; " +
        "investigate this trigger on its own terms.";

  return [
    `## Prior art — ${prior.id} (${recallResult.verdict}${recallResult.mechanism ? `: ${recallResult.mechanism}` : ""})`,
    stance,
    "",
    `Previously concluded: ${prior.headline}`,
    "",
    String(prior.rca).slice(0, 2000),
    "",
    "NOTE: the [E#] ids above belong to that earlier investigation. They are NOT yours to cite.",
    "Cite only evidence ids returned to you by your own tool calls in this session.",
  ].join("\n");
}

module.exports = { recall, findCandidates, priorArtBlock, summarizeCandidate, MAX_CANDIDATES };
