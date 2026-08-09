// The step most agent demos skip: after a decision (fix drafted, fix declined, fix reused),
// come back later and check whether reality agrees.
//
// Without this, "applied" just means a PR got opened — nobody knows if it worked. And a
// declined incident ("this is an operator issue, no code needed") never gets checked either;
// if the decline was wrong, nothing ever finds out. Both are unverified claims wearing the
// costume of a resolved incident.
//
// This module closes that loop: schedule a re-check when a remediation outcome lands, then
// after a delay, run a short evidence-gathering pass against fresh telemetry and record
// whether the original symptom actually recovered. A confirmed recovery resolves the
// incident, citations attached. An unresolved one stays open — and feeds back into
// src/memory/recall.js so a fix that didn't hold stops being blindly reused (see
// attachRemediation's guard in sentinel/daemon.js).
//
// Still read-only: verifyRecovery only ever calls the same GET-only tools investigation uses.
// Verifying is not an exception to guardrail #1, it's another application of it.

"use strict";

const { runDecisionLoop, MODELS } = require("../llm/client");
const { Ledger } = require("../evidence/ledger");
const { practicesBlock } = require("../practices");
const tools = require("../investigator/tools");
const store = require("../store/state");

// Long enough for a merged PR or an operator's flag flip to take effect and for fresh
// telemetry to accumulate; short enough that a real incident doesn't sit unverified for the
// life of a demo. Overridable for testing without code changes.
const REDEMPTION_DELAY_MS = Number(process.env.SRE_REDEMPTION_DELAY_MS) || 15 * 60 * 1000;
const VERIFY_TURNS = 5;
const TERMINAL_STATUSES = new Set(["resolved", "closed", "mitigated"]);

function buildHandlers(ledger) {
  const bound = {
    query_metrics: (a) => tools.query_metrics(a.promql, ledger),
    query_logs: (a) => tools.query_logs(a.logql, a.sinceMinutes, ledger),
    search_traces: (a) => tools.search_traces(a.tagFilter, a.limit, ledger),
    search_traces_ql: (a) => tools.search_traces_ql(a.traceql, a.limit, ledger),
    get_trace: (a) => tools.get_trace(a.traceId, ledger),
    compare_baseline: (a) => tools.compare_baseline(a.promql, a.minutes, ledger),
    derive_baseline: (a) => tools.derive_baseline(a.promql, a.lookbackHours, ledger),
  };
  const handlers = {};
  for (const [name, fn] of Object.entries(bound)) {
    handlers[name] = async (args = {}) => {
      const r = await fn(args || {});
      return { id: r.id, summary: r.summary, ...(r.stats ? { stats: r.stats } : {}) };
    };
  }
  return handlers;
}

function remediationSummary(incident) {
  const r = incident.remediation;
  if (!r) return "No remediation was recorded for this incident.";
  if (r.kind === "no_code_fix") return `Declined a repo change: ${r.reason}`;
  if (r.kind === "reused") return `Reused an existing fix from ${r.fromIncident}: ${r.note}`;
  if (r.kind === "github_pr") return "Drafted a PR proposal — check whether it was approved and, if so, whether the change actually took effect.";
  if (r.kind === "draft_failed") return `Remediation drafting itself failed: ${r.error}`;
  return `Unrecognised remediation kind '${r.kind}'.`;
}

const SYSTEM_PROMPT = `
You are checking whether a previously diagnosed incident has actually recovered — the last
step of the loop, after diagnosis and remediation, that most autonomous agents skip.

This is NOT a fresh investigation. You already know what "wrong" looked like: the incident's
own root-cause analysis is given to you below. Your only job is to find out, with fresh
queries against CURRENT telemetry, whether it still looks that way.

Prefer a real comparison over a bare current reading. "The error rate is 0 right now" is
weaker evidence than "the error rate has matched its derive_baseline mean for the last hour."
Use derive_baseline or compare_baseline before concluding recovered, not just query_metrics.

Call verify_recovery exactly once, when you have enough evidence either way. Every factual
claim in your reason must carry a [E#] citation to a query you ran in THIS check — you may
not cite the original incident's [E#] ids, those belong to an earlier investigation and are
not proof of the CURRENT state.

If the remediation was a drafted PR that was never approved and applied, a code fix cannot be
the reason for any recovery you observe — say so plainly, and if the symptom did clear, credit
whatever the evidence actually shows (e.g. traffic dropped to near zero, an operator action,
or simple noise) rather than the unapplied fix. Report low confidence when the evidence is
genuinely ambiguous — a wrong "recovered" verdict closes an incident that is still live.
`.trim();

function systemPrompt() {
  const p = practicesBlock();
  return p ? `${SYSTEM_PROMPT}\n\n---\n\n${p}` : SYSTEM_PROMPT;
}

const TERMINAL_TOOL = "verify_recovery";
const TOOLS_DEF = [
  ...tools.toToolDefinitions(),
  {
    type: "function",
    function: {
      name: "verify_recovery",
      description: "Report whether the originally diagnosed symptom has recovered, based on fresh evidence gathered in this check.",
      parameters: {
        type: "object",
        properties: {
          recovered: { type: "boolean" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", description: "Cited explanation — every factual claim needs a [E#]." },
        },
        required: ["recovered", "confidence", "reason"],
      },
    },
  },
];

function buildUserMessage(incident) {
  return [
    `Incident ${incident.id} — service: ${incident.service} — confidence at diagnosis: ${incident.confidence}`,
    "",
    "Original headline:",
    incident.headline,
    "",
    "What remediation happened:",
    remediationSummary(incident),
    "",
    "Original root-cause analysis (for context only — its [E#] ids are not yours to cite):",
    String(incident.rca || "").slice(0, 1500),
    "",
    "Verify with fresh queries now.",
  ].join("\n");
}

/**
 * Runs one verification pass for `incident`. Returns
 * `{ recovered, confidence, reason, citedEvidence, turnsUsed }`. Throws on a genuine failure
 * (network error, model error, exhausted turns) — the caller is expected to catch this and
 * reschedule, never to silently mark an incident resolved on a failed check.
 */
async function verifyRecovery(incident, { ledger = null, model = MODELS.fast } = {}) {
  const activeLedger = ledger || new Ledger();

  const { call } = await runDecisionLoop({
    model,
    system: systemPrompt(),
    messages: [{ role: "user", content: buildUserMessage(incident) }],
    tools: TOOLS_DEF,
    handlers: buildHandlers(activeLedger),
    terminalTools: [TERMINAL_TOOL],
    maxTurns: VERIFY_TURNS,
  });

  const { recovered, confidence } = call.args;
  let reason = call.args.reason || "";

  // A verdict that closes an incident is exactly the claim that most needs its citations to
  // be real, not just warned about — one repair attempt before this ships (Ledger.repair).
  const { unresolved: initialUnresolved } = activeLedger.validate(reason);
  let unresolved = initialUnresolved;
  if (unresolved.length) {
    const repair = await activeLedger.repair(reason);
    reason = repair.text;
    unresolved = repair.stillUnresolved;
    if (unresolved.length) {
      // eslint-disable-next-line no-console
      console.warn(`verifyRecovery(${incident.id}): unresolved citations survived repair: ${unresolved.join(", ")}`);
    }
  }
  const cited = activeLedger.cited(reason);

  return {
    recovered: Boolean(recovered),
    confidence: confidence || "low",
    reason,
    citedEvidence: cited.filter((id) => !unresolved.includes(id)),
  };
}

// Marks `incident` for a redemption check after `REDEMPTION_DELAY_MS`. Called once, right
// after any remediation outcome lands (draft, decline, reuse, or drafting failure) — every
// path deserves a check, since a wrongly-declined incident is exactly as unverified as a
// wrongly-applied fix.
function scheduleRedemption(incidentId, note) {
  store.update((s) => {
    const inc = s.incidents.find((i) => i.id === incidentId);
    if (!inc || TERMINAL_STATUSES.has(inc.status)) return;
    inc.redemption = {
      status: "pending",
      note,
      scheduledAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + REDEMPTION_DELAY_MS).toISOString(),
      attempts: inc.redemption?.attempts || 0,
    };
  });
}

// Records a verified outcome. A confident recovery closes the incident with a citation trail;
// a low-confidence "recovered" re-checks later rather than closing on shaky evidence; anything
// else stays open, unresolved, and visible for memory to learn from.
function recordRedemptionResult(incidentId, result) {
  store.update((s) => {
    const inc = s.incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    const attempts = (inc.redemption?.attempts || 0) + 1;
    const checkedAt = new Date().toISOString();

    if (result.recovered && result.confidence !== "low") {
      inc.redemption = { status: "confirmed", ...result, checkedAt, attempts };
      inc.status = "resolved";
      inc.resolvedAt = checkedAt;
      inc.resolvedBy = "redemption-check";
    } else if (result.recovered) {
      inc.redemption = {
        status: "pending", ...result, checkedAt, attempts,
        dueAt: new Date(Date.now() + REDEMPTION_DELAY_MS).toISOString(),
      };
    } else {
      inc.redemption = { status: "unresolved", ...result, checkedAt, attempts };
    }
  });
}

/**
 * Runs verification for every incident whose redemption is due. Called once per sweep. Never
 * throws — a failed check reschedules itself (with the error noted) rather than leaving an
 * incident wedged in "pending" with a `dueAt` that would re-fire every sweep forever.
 */
async function runRedemptionChecks() {
  const state = store.load();
  const now = Date.now();
  const due = (state.incidents || []).filter(
    (i) => i.redemption?.status === "pending"
      && !TERMINAL_STATUSES.has(i.status)
      && new Date(i.redemption.dueAt).getTime() <= now
  );

  const results = [];
  for (const incident of due) {
    const ledger = new Ledger();
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await verifyRecovery(incident, { ledger });
      recordRedemptionResult(incident.id, result);
      console.log(
        `[redemption] ${incident.id}: ${result.recovered ? "recovered" : "still failing"} ` +
          `(${result.confidence}) — ${result.reason.slice(0, 140)}`
      );
      results.push({ incidentId: incident.id, ...result });
    } catch (err) {
      scheduleRedemption(incident.id, `previous check errored: ${err.message}`);
      console.error(`[redemption] ${incident.id}: check failed — ${err.message}`);
    }
  }
  return results;
}

module.exports = {
  scheduleRedemption, recordRedemptionResult, runRedemptionChecks, verifyRecovery,
  REDEMPTION_DELAY_MS,
};
