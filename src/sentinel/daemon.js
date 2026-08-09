// The agency loop: sweep the fleet on an interval, unprompted, and open real incidents when
// triage's own judgement says a service warrants a closer look. This file is what makes
// "the agent noticed on its own" true rather than aspirational — it has to actually be
// running, not just callable, for the Agency trait to mean anything.
//
// Field names written onto each incident (service/confidence/headline/rca/resolution/
// revisions) match bin/sre's documented alias lookups exactly (see its header comment) —
// no guessing needed on either side of that boundary.

const { Ledger } = require("../evidence/ledger");
const store = require("../store/state");
const { buildFrame } = require("./frame");
const { triage } = require("./triage");
const { investigate } = require("../investigator/loop");
const { draftRemediation } = require("../actions/remediation");
const { recall, priorArtBlock } = require("../memory/recall");
const { probeFleet } = require("../lgtm/health");
const { explainFleet } = require("../actions/explain");
const { scheduleRedemption, runRedemptionChecks } = require("../actions/redemption");

// A recalled diagnosis still gets verified live, but it does not need the full search that
// produced it the first time — the hypothesis is already on the table, so the remaining work
// is confirming it still holds. This is where the token saving actually comes from.
const VERIFY_TURNS = 4;

const DEFAULT_INTERVAL_MS = Number(process.env.SRE_SWEEP_INTERVAL_MS) || 45000;
const TERMINAL_STATUSES = new Set(["resolved", "closed", "mitigated"]);

function deriveConfidence(hypothesisHistory) {
  if (!hypothesisHistory.length) return "low";
  const last = hypothesisHistory[hypothesisHistory.length - 1];
  if (last.status === "CONFIRMED") return "high";
  if (last.status === "DISCONFIRMED") return "low";
  return "medium"; // NEW or REVISED with no further confirming attempt captured
}

function extractHeadline(finalRca) {
  const firstBlock = String(finalRca).split(/\n\s*\n/)[0] || finalRca;
  return firstBlock.replace(/\s+/g, " ").trim().slice(0, 220);
}

// Pulls the "Recommended next steps:" section out of the RCA's own required format
// (see loop.js's SYSTEM_PROMPT) — text extraction, not a judgement call. Only lines that
// actually start with a real ordinal marker count as a step: the heading itself sometimes
// carries a trailing parenthetical (e.g. "next steps (tied to the evidence):") that would
// otherwise get captured as a fake first step, and the model sometimes appends an unnumbered
// follow-up offer after the list that isn't a resolution step at all.
function extractResolutionSteps(finalRca) {
  const match = String(finalRca).match(/Recommended next steps:?\s*([\s\S]*)$/i);
  if (!match) return [];
  return match[1]
    .split(/\n/)
    .filter((line) => /^\s*\d+[.)]\s/.test(line))
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

function hasOpenIncidentFor(state, service) {
  return state.incidents.some((inc) => inc.service === service && !TERMINAL_STATUSES.has(inc.status));
}

// Records what the remediation author decided onto the incident itself, so the dashboard can
// show "the agent has a fix ready" without re-deriving it from the proposals list.
function recordRemediationOutcome(incidentId, outcome) {
  store.update((s) => {
    const inc = s.incidents.find((i) => i.id === incidentId);
    if (inc) inc.remediation = { ...outcome, at: new Date().toISOString() };
  });
}

// Having concluded, the agent decides on its own whether this incident warrants a change to
// the SRE-as-code repo and, if so, writes it — no human asks it to. The result is a DRAFT
// proposal only; opening the PR stays gated behind explicit approval.
//
// A failure here must never cost us the incident: the investigation already succeeded and its
// RCA is worth keeping regardless of whether the follow-up fix could be authored. The failure
// is recorded on the incident rather than swallowed, so a silent gap is visible as one.
async function attachRemediation(incident, ledger, memory = null) {
  // If this is a recurrence of a failure the agent already authored a fix for, re-authoring
  // that fix would produce a second, near-identical PR for the same cause. Point at the
  // existing proposal instead — the saving here is a whole model call plus a duplicate PR
  // nobody wanted to review twice.
  // A prior incident whose redemption check came back "unresolved" is proof its fix did NOT
  // hold — reusing it here would repeat a mistake the agent already knows about. Fall through
  // to authoring fresh instead of pointing at a fix already known to have failed. This is the
  // self-learning feedback loop: an outcome, not just a diagnosis, changes future behaviour.
  const priorFixKnownBad = memory?.priorIncident?.redemption?.status === "unresolved";
  const prior = memory?.verdict === "reuse" && !priorFixKnownBad ? memory.priorIncident : null;
  if (priorFixKnownBad) {
    console.log(
      `[sentinel] ${incident.id}: not reusing ${memory.priorIncident.id}'s fix — its redemption check found it didn't hold`
    );
  }
  if (prior) {
    const existing = (store.load().proposals || []).find(
      (p) => p.payload?.incidentId === prior.id && ["draft", "revised", "approved", "applied"].includes(p.status)
    );
    if (existing) {
      recordRemediationOutcome(incident.id, {
        kind: "reused",
        proposalId: existing.id,
        fromIncident: prior.id,
        note: `Same failure mechanism as ${prior.id}; its proposal ${existing.id} (${existing.status}) already covers this.`,
      });
      console.log(`[sentinel] ${incident.id}: reusing ${existing.id} from ${prior.id} — no new fix authored`);
      return;
    }
    if (prior.remediation?.kind === "no_code_fix") {
      recordRemediationOutcome(incident.id, {
        kind: "no_code_fix",
        reason: `Same failure mechanism as ${prior.id}, where a repo change was already ruled out: ${prior.remediation.reason}`,
        fromIncident: prior.id,
      });
      console.log(`[sentinel] ${incident.id}: reusing ${prior.id}'s decision to propose no repo change`);
      return;
    }
  }

  try {
    const outcome = await draftRemediation(incident, { ledger });
    if (outcome.kind === "no_code_fix") {
      recordRemediationOutcome(incident.id, { kind: "no_code_fix", reason: outcome.reason });
      console.log(`[sentinel] ${incident.id}: no repo change proposed — ${outcome.reason}`);
    } else {
      recordRemediationOutcome(incident.id, { kind: "github_pr", proposalId: outcome.proposal.id });
      console.log(`[sentinel] ${incident.id}: drafted PR proposal ${outcome.proposal.id} — awaiting approval`);
    }
  } catch (err) {
    recordRemediationOutcome(incident.id, { kind: "draft_failed", error: err.message });
    console.error(`[sentinel] ${incident.id}: remediation drafting failed: ${err.message}`);
  }
}

// Folds recalled prior art into the frame the investigator starts from. The frame may be an
// object (buildFrame's normal output) or a string; either way the prior art is appended as
// clearly-labelled orientation, never as citable evidence.
function frameWithPriorArt(frame, memory) {
  const priorArt = priorArtBlock(memory);
  if (!priorArt) return frame;
  const base = typeof frame === "string" ? frame : JSON.stringify(frame, null, 2);
  return `${base}\n\n${priorArt}`;
}

async function openIncidentFromInvestigation(service, trigger, frame) {
  const ledger = new Ledger();

  // Ask memory first. A recurrence of an already-diagnosed fault gets a short verification
  // pass instead of a full search; a genuinely new failure gets the whole budget. Recall is
  // one cheap call and degrades to "novel" on any failure, so it can only ever cost a little
  // or save a lot — it never blocks the investigation.
  const memory = await recall({ trigger, service, state: store.load() });
  const reusing = memory.verdict === "reuse";
  console.log(
    `[sentinel] recall for ${service}: ${memory.verdict}` +
      `${memory.incidentId ? ` (${memory.incidentId})` : ""} — ${memory.reason}`
  );

  const result = await investigate({
    trigger: reusing
      ? `${trigger}\n\nThis appears to recur a failure already diagnosed in ${memory.incidentId}. Confirm with your own queries whether that same mechanism is active right now, and say plainly if the evidence disagrees.`
      : trigger,
    frame: frameWithPriorArt(frame, memory),
    ledger,
    maxTurns: reusing ? VERIFY_TURNS : undefined,
  });

  const incident = store.newIncident({
    service,
    confidence: deriveConfidence(result.hypothesis_history),
    headline: extractHeadline(result.final_rca),
    rca: result.final_rca,
    resolution: extractResolutionSteps(result.final_rca),
    revisions: result.hypothesis_history.map((h) => ({
      at: new Date().toISOString(),
      hypothesis: h.text,
      status: h.status,
      turn: h.turn,
    })),
    steps: [],
    unresolvedCitations: result.unresolvedCitations,
    // Kept on the incident so the dashboard can show that this one cost a verification pass
    // rather than a full investigation, and which prior incident taught it that.
    memory: {
      verdict: memory.verdict,
      fromIncident: memory.incidentId || null,
      mechanism: memory.mechanism || null,
      reason: memory.reason,
      candidatesConsidered: memory.candidatesConsidered,
      turnsUsed: result.turns,
      turnBudget: reusing ? VERIFY_TURNS : null,
    },
  });

  await attachRemediation(incident, ledger, memory);
  // Every remediation outcome — drafted, declined, reused, or even a failed draft attempt —
  // is a claim about the incident's fate. Schedule a check regardless of which branch fired;
  // an unverified decline is exactly as risky as an unverified fix.
  scheduleRedemption(incident.id, "initial remediation outcome recorded");
  return store.load().incidents.find((i) => i.id === incident.id) || incident;
}

async function sweepOnce() {
  const sweepLedger = new Ledger();
  const frame = await buildFrame(sweepLedger);
  const decision = await triage(frame);

  // Live per-service health, recorded every sweep. Independent of the incident list on
  // purpose: "no incident" must never be allowed to render as "healthy" when the real answer
  // is "this service stopped emitting and nobody has looked yet". A probe failure is stored
  // as-is rather than dropped — a stale-but-labelled reading beats a silent one.
  let health;
  try {
    health = await probeFleet();
  } catch (err) {
    health = { at: new Date().toISOString(), reachable: false, error: err.message, services: [] };
  }

  const state = store.update((s) => {
    s.lastSweep = new Date().toISOString();
    s.health = health;
  });

  // Translate the readings into something a non-engineer can act on. Deliberately after the
  // health write, so the numbers are on the dashboard even if this fails — the summary is a
  // presentation aid over data that already stands on its own.
  const summary = await explainFleet({ health, incidents: state.incidents });
  if (summary) store.update((s) => { s.fleetSummary = summary; });

  const opened = [];
  const failed = [];
  for (const anomaly of decision.anomalies) {
    if (hasOpenIncidentFor(state, anomaly.service)) continue; // already tracking this one
    const trigger = `Fleet sweep flagged ${anomaly.service} as anomalous: ${anomaly.reason}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const incident = await openIncidentFromInvestigation(anomaly.service, trigger, frame);
      opened.push(incident);
      console.log(`[sentinel] opened ${incident.id} for ${anomaly.service}: ${incident.headline}`);
    } catch (err) {
      // One investigation failing (e.g. a transient network error) must not cost the other
      // anomalies in this same sweep their chance at a real incident — isolate the failure,
      // log it plainly, and keep going. The next sweep will retry this service regardless.
      failed.push({ service: anomaly.service, error: err.message });
      console.error(`[sentinel] investigation failed for ${anomaly.service}: ${err.message}`);
    }
  }

  if (decision.emergingRisks.length) {
    store.update((s) => {
      s.emergingRisks = s.emergingRisks || [];
      for (const risk of decision.emergingRisks) {
        s.emergingRisks.push({ ...risk, notedAt: new Date().toISOString() });
      }
    });
  }

  // Closing the loop on incidents opened by earlier sweeps: re-verify whatever came due, so
  // "applied"/"declined" can become "confirmed resolved" (or, just as importantly, surface as
  // "didn't hold") with fresh cited evidence rather than sitting as an unchecked claim forever.
  const redemptions = await runRedemptionChecks();

  return { ...decision, opened, failed, redemptions };
}

async function runDaemon({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  console.log(`[sentinel] daemon starting — sweeping every ${intervalMs}ms, unprompted`);
  for (;;) {
    const startedAt = Date.now();
    try {
      // eslint-disable-next-line no-await-in-loop
      const decision = await sweepOnce();
      const n = decision.anomalies.length;
      const r = decision.emergingRisks.length;
      const failedSuffix = decision.failed.length ? `, ${decision.failed.length} investigation(s) failed (will retry next sweep)` : "";
      const redeemedSuffix = decision.redemptions.length
        ? `, ${decision.redemptions.length} redemption check(s) run (${decision.redemptions.filter((x) => x.recovered).length} recovered)`
        : "";
      console.log(`[sentinel] sweep complete: ${n} anomal${n === 1 ? "y" : "ies"}, ${r} emerging risk(s), ${decision.opened.length} incident(s) opened${failedSuffix}${redeemedSuffix}`);
    } catch (err) {
      console.error("[sentinel] sweep failed:", err.message);
    }
    const wait = Math.max(1000, intervalMs - (Date.now() - startedAt));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

module.exports = {
  sweepOnce, runDaemon, openIncidentFromInvestigation, attachRemediation,
  deriveConfidence, extractHeadline, extractResolutionSteps, hasOpenIncidentFor,
};

if (require.main === module) {
  require("../env").loadEnv();
  runDaemon().catch((err) => {
    console.error("[sentinel] daemon crashed:", err.stack || err.message);
    process.exitCode = 1;
  });
}
