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

async function openIncidentFromInvestigation(service, trigger, frame) {
  const ledger = new Ledger();
  const result = await investigate({ trigger, frame, ledger });

  return store.newIncident({
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
  });
}

async function sweepOnce() {
  const sweepLedger = new Ledger();
  const frame = await buildFrame(sweepLedger);
  const decision = await triage(frame);

  const state = store.update((s) => {
    s.lastSweep = new Date().toISOString();
  });

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

  return { ...decision, opened, failed };
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
      console.log(`[sentinel] sweep complete: ${n} anomal${n === 1 ? "y" : "ies"}, ${r} emerging risk(s), ${decision.opened.length} incident(s) opened${failedSuffix}`);
    } catch (err) {
      console.error("[sentinel] sweep failed:", err.message);
    }
    const wait = Math.max(1000, intervalMs - (Date.now() - startedAt));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

module.exports = {
  sweepOnce, runDaemon, openIncidentFromInvestigation,
  deriveConfidence, extractHeadline, extractResolutionSteps, hasOpenIncidentFor,
};

if (require.main === module) {
  runDaemon().catch((err) => {
    console.error("[sentinel] daemon crashed:", err.stack || err.message);
    process.exitCode = 1;
  });
}
