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
const { probeFleet, probeStack } = require("../lgtm/health");
const { explainFleet } = require("../actions/explain");
const { scheduleRedemption, runRedemptionChecks } = require("../actions/redemption");
const policy = require("../investigator/policy");

// A recalled diagnosis still gets verified live, but it does not need the full search that
// produced it the first time — the hypothesis is already on the table, so the remaining work
// is confirming it still holds. This is where the token saving actually comes from.
const VERIFY_TURNS = 4;

const DEFAULT_INTERVAL_MS = Number(process.env.SRE_SWEEP_INTERVAL_MS) || 45000;
const TERMINAL_STATUSES = new Set(["resolved", "closed", "mitigated"]);

// Thin wrapper kept for anything still calling daemon.js's own deriveConfidence expecting a
// bare string — the real judgement, including whether the trail EARNED that confidence, now
// lives in src/investigator/policy.js (the explicit policy layer malleability was missing).
function deriveConfidence(hypothesisHistory) {
  return policy.deriveConfidence(hypothesisHistory).level;
}

// The RCA's first block IS the headline (loop.js's SYSTEM_PROMPT asks for it that way), but
// the model often re-states the prompt's own label first — "Headline: - checkout — ...". That
// prefix is scaffolding from the format, not content, and stripping it here rather than only
// at render time matters: this stored string is what the recall prompt, the PR body, the MCP
// list_incidents result, and the copilot's grounding packet all read. Left in, "Headline:
// Headline: - checkout" is what a reviewer sees in a pull request.
//
// Text extraction, not a judgement — it removes a label the prompt put there, and changes no
// claim the model made.
function extractHeadline(finalRca) {
  const firstBlock = String(finalRca).split(/\n\s*\n/)[0] || finalRca;
  return firstBlock
    .replace(/\s+/g, " ")
    // The separator is required and must be a colon or a spaced dash — without that, a
    // service genuinely called "headline-service" loses its own name to the stripper.
    .replace(/^\s*-?\s*\*{0,2}headline\*{0,2}\s*(?::|\s-)\s*\*{0,2}\s*-?\s*/i, "")
    .trim()
    .slice(0, 220);
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

// A tuning constant, not a business threshold — sreoncall-alerting's own distinction applies
// here too. This governs how many times a PATTERN must recur before it earns its own
// investigation; it says nothing about what counts as anomalous in the first place, which
// stays triage's live judgement, made fresh every sweep with no fixed cutoff.
const RISK_ESCALATION_COUNT = 3;
const RISK_ESCALATION_WINDOW_MS = 30 * 60 * 1000;

// An emerging risk noted once is background chatter — triage already decided it wasn't worth
// a full investigation yet. The SAME (service, riskType) pattern noted several times inside a
// real window is a trend the agent should stop merely logging and start investigating on its
// own initiative: this is what agency means for a signal too quiet for any single sweep to
// act on alone, but too persistent to keep silently re-noting sweep after sweep.
//
// Pure function — `allEmergingRisks` is the full, already-updated history (including this
// sweep's own new entries); `newlyNoted` is just this sweep's additions, so escalation is
// judged once per genuinely new risk, not re-fired every sweep for a pattern already acted on.
function escalatedRisks(allEmergingRisks, newlyNoted) {
  const now = Date.now();
  const recentCounts = new Map();
  for (const r of allEmergingRisks || []) {
    if (now - new Date(r.notedAt).getTime() > RISK_ESCALATION_WINDOW_MS) continue;
    const key = `${r.service}|${r.riskType}`;
    recentCounts.set(key, (recentCounts.get(key) || 0) + 1);
  }

  const escalated = [];
  const seenKeys = new Set();
  for (const r of newlyNoted || []) {
    const key = `${r.service}|${r.riskType}`;
    if (seenKeys.has(key)) continue; // dedup within this sweep's own new risks
    if ((recentCounts.get(key) || 0) >= RISK_ESCALATION_COUNT) {
      escalated.push(r);
      seenKeys.add(key);
    }
  }
  return escalated;
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

function errorRecord(err) {
  const message = String(err?.message || err || "unknown sentinel failure");
  const llmCode = message.match(/LLM unavailable \(([^)]+)\)/)?.[1];
  return {
    code: err?.code || llmCode || "sweep_failed",
    message: message.split("\n")[0].slice(0, 500),
  };
}

async function openIncidentFromInvestigation(service, trigger, frame, detectedAt = new Date().toISOString()) {
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

  const confidenceVerdict = policy.deriveConfidence(result.hypothesis_history);
  if (confidenceVerdict.capped) {
    console.log(
      `[sentinel] ${service}: confidence capped at medium — ${confidenceVerdict.policy.reason}`
    );
  }

  const incident = store.newIncident({
    service,
    // The real signal-arrival timestamp — the moment triage flagged this, before recall or
    // investigation ran — kept distinct from openedAt (when the incident record itself gets
    // created, after the full investigation concludes). The gap between the two is genuine
    // detection-to-diagnosis latency, the kind of thing an evented pipeline gives you for free
    // and a single "opened" timestamp quietly throws away.
    detectedAt,
    confidence: confidenceVerdict.level,
    // Why the confidence landed where it did — an explicit, code-checked verdict on the
    // trail's own discipline, not just the model's self-reported last tag. This is what makes
    // "the model says CONFIRMED" and "the model EARNED confirmed" distinguishable after the
    // fact, on every incident, not just the ones where it happens to come up.
    confidencePolicy: { disciplined: confidenceVerdict.policy.disciplined, reason: confidenceVerdict.policy.reason, capped: confidenceVerdict.capped },
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
    // Which evidence kinds (metric/log/trace) this RCA actually drew on, and whether the
    // completion gate had to intervene before it was allowed to finalize — the structural
    // version of "always check the logs too" (investigator/loop.js's REQUIRED_SIGNAL_KINDS).
    signalCoverage: result.signalCoverage,
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
  // Liveness, set first and unconditionally: "the daemon reached this iteration," independent
  // of whether anything downstream succeeds. This was a real bug — it used to be set only
  // after triage() returned, and triage() throws by design when the LLM is unavailable
  // (sreoncall-ai-native-gate: detection must fail loud, never fake a result). During a real
  // outage, that meant lastSweep went stale and docker-compose.yml's own healthcheck reported
  // a daemon that was alive, looping, and correctly failing loud as UNHEALTHY — conflating
  // "the loop is running" with "the loop's last attempt succeeded". What actually failed is
  // already visible in this sweep's own error logs; lastSweep only ever needs to answer "is
  // the process still iterating," and now it does regardless of what fails below.
  store.update((s) => { s.lastSweep = new Date().toISOString(); });

  const sweepLedger = new Ledger();
  // Collection is deliberately independent from model reasoning. Metrics, traces, backend
  // reachability, and per-service health all land in state BEFORE triage calls the LLM. If the
  // model is unavailable, the dashboard still receives current telemetry and an explicit
  // degraded sentinel state instead of freezing at the last successful AI decision.
  const [frameResult, healthResult, stackResult] = await Promise.allSettled([
    buildFrame(sweepLedger),
    probeFleet(),
    probeStack(),
  ]);
  const collectedAt = new Date().toISOString();
  const health = healthResult.status === "fulfilled"
    ? healthResult.value
    : { at: collectedAt, reachable: false, error: healthResult.reason?.message || "fleet probe failed", services: [] };
  const backends = stackResult.status === "fulfilled"
    ? stackResult.value
    : { stack: { up: false, latencyMs: null, error: stackResult.reason?.message || "stack probe failed" } };
  const frame = frameResult.status === "fulfilled" ? frameResult.value : null;
  const state = store.update((s) => {
    s.health = health;
    s.telemetry = {
      at: collectedAt,
      status: frame ? "current" : "degraded",
      frameAt: frame?.at || null,
      evidenceIds: frame?.evidenceIds || [],
      backends,
      error: frame ? null : errorRecord(frameResult.reason),
    };
  });

  if (!frame) throw frameResult.reason;

  const decision = await triage(frame);

  // Translate the readings into something a non-engineer can act on. Deliberately after the
  // health write, so the numbers are on the dashboard even if this fails — the summary is a
  // presentation aid over data that already stands on its own.
  const summary = await explainFleet({ health, incidents: state.incidents });
  if (summary) store.update((s) => { s.fleetSummary = summary; });

  // Emerging risks are recorded BEFORE the fan-out below (not after, as before) — escalation
  // has to count against the fully up-to-date history, including this sweep's own new
  // entries, and an escalated risk needs to be available to join the SAME sweep's fan-out
  // rather than waiting a full extra interval to be acted on.
  let riskState = state;
  if (decision.emergingRisks.length) {
    riskState = store.update((s) => {
      s.emergingRisks = s.emergingRisks || [];
      for (const risk of decision.emergingRisks) {
        s.emergingRisks.push({ ...risk, notedAt: new Date().toISOString() });
      }
    });
  }

  // Agency, exercised on a signal too quiet for any one sweep to act on alone: a risk noted
  // repeatedly for the same (service, riskType) inside a real window graduates from "logged"
  // to "investigated", entirely on the agent's own initiative — nobody has to notice the
  // pattern and manually open an incident for it. See escalatedRisks' own comment for why the
  // threshold is a tuning constant, not a business one.
  const escalated = escalatedRisks(riskState.emergingRisks, decision.emergingRisks).map((r) => ({
    service: r.service,
    reason: `A recurring pattern ("${r.riskType}") was noted ${RISK_ESCALATION_COUNT}+ times in the last ${RISK_ESCALATION_WINDOW_MS / 60000} minutes: ${r.reason}`,
  }));
  if (escalated.length) {
    console.log(`[sentinel] escalating ${escalated.length} recurring risk(s) to a full investigation: ${escalated.map((e) => e.service).join(", ")}`);
  }

  // Deduped by service, fresh anomalies taking priority over escalated risks for the same
  // service — the fan-out below opens at most one investigation per service per sweep. Without
  // this, two sources both naming the same service (triage flagging it fresh AND its own
  // history crossing the escalation threshold in the same sweep, or triage's own output
  // repeating a service) would fan out two CONCURRENT investigations for one service — a race
  // hasOpenIncidentFor's single pre-fan-out snapshot cannot catch, since both branches check
  // against incidents that exist before either one finishes.
  const seenServices = new Set();
  const allAnomalies = [...decision.anomalies, ...escalated].filter((a) => {
    if (seenServices.has(a.service)) return false;
    seenServices.add(a.service);
    return true;
  });

  // A detection EVENT is recorded the instant something is flagged for investigation — whether
  // a fresh single-sweep anomaly or an escalated recurring risk — independent of whether an
  // incident ever results (a duplicate this sweep, a failed investigation). This is the honest
  // evented-style record a single "incident opened" timestamp can't give you: signal arrived,
  // here, now, whether or not anything downstream succeeds. Bounded so a long-running daemon
  // doesn't grow this file forever.
  const detectedAt = new Date().toISOString();
  if (allAnomalies.length) {
    store.update((s) => {
      s.detections = s.detections || [];
      for (const anomaly of allAnomalies) {
        s.detections.push({ at: detectedAt, service: anomaly.service, reason: anomaly.reason });
      }
      if (s.detections.length > 500) s.detections = s.detections.slice(-500);
    });
  }

  // Each item is an independent unit of work — investigated concurrently, not one at a time.
  // Safe because store.js's cross-process lock already serializes the actual writes; what used
  // to be a blocking serial loop is now a real fan-out, which is both faster (one sweep's
  // total time is the slowest single investigation, not their sum) and the honest shape of
  // "several signals arrived at once", closer to how an evented pipeline would actually
  // process them. Never lets one item's failure reject the whole batch — each settles
  // independently, tagged with which one it was.
  const results = await Promise.all(
    allAnomalies
      .filter((anomaly) => !hasOpenIncidentFor(state, anomaly.service)) // already tracking this one
      .map(async (anomaly) => {
        const trigger = `Fleet sweep flagged ${anomaly.service} as anomalous: ${anomaly.reason}`;
        try {
          const incident = await openIncidentFromInvestigation(anomaly.service, trigger, frame, detectedAt);
          return { ok: true, service: anomaly.service, incident };
        } catch (err) {
          // One investigation failing (e.g. a transient network error) must not cost the other
          // anomalies in this same sweep their chance at a real incident — isolate the
          // failure; the next sweep retries this service regardless.
          return { ok: false, service: anomaly.service, error: err.message };
        }
      })
  );

  const opened = [];
  const failed = [];
  for (const r of results) {
    if (r.ok) {
      opened.push(r.incident);
      console.log(`[sentinel] opened ${r.incident.id} for ${r.service}: ${r.incident.headline}`);
    } else {
      failed.push({ service: r.service, error: r.error });
      console.error(`[sentinel] investigation failed for ${r.service}: ${r.error}`);
    }
  }

  // Closing the loop on incidents opened by earlier sweeps: re-verify whatever came due, so
  // "applied"/"declined" can become "confirmed resolved" (or, just as importantly, surface as
  // "didn't hold") with fresh cited evidence rather than sitting as an unchecked claim forever.
  const redemptions = await runRedemptionChecks();

  const completedAt = new Date().toISOString();
  store.update((s) => {
    s.lastSweep = completedAt;
    if (s.telemetry) s.telemetry.lastAnalyzedAt = completedAt;
  });

  return { ...decision, escalatedCount: escalated.length, opened, failed, redemptions };
}

async function runDaemon({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  console.log(`[sentinel] daemon starting — sweeping every ${intervalMs}ms, unprompted`);
  const startedAt = new Date().toISOString();
  store.update((s) => {
    s.sentinel = {
      ...(s.sentinel || {}),
      status: "starting",
      startedAt,
      lastAttemptAt: null,
      lastError: null,
    };
  });
  for (;;) {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();
    store.update((s) => {
      s.sentinel = {
        ...(s.sentinel || {}),
        status: "running",
        lastAttemptAt: attemptedAt,
      };
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      const decision = await sweepOnce();
      const succeededAt = new Date().toISOString();
      store.update((s) => {
        s.sentinel = {
          ...(s.sentinel || {}),
          status: "healthy",
          lastSuccessAt: succeededAt,
          lastError: null,
        };
      });
      const n = decision.anomalies.length;
      const r = decision.emergingRisks.length;
      const failedSuffix = decision.failed.length ? `, ${decision.failed.length} investigation(s) failed (will retry next sweep)` : "";
      const redeemedSuffix = decision.redemptions.length
        ? `, ${decision.redemptions.length} redemption check(s) run (${decision.redemptions.filter((x) => x.recovered).length} recovered)`
        : "";
      const escalatedSuffix = decision.escalatedCount
        ? `, ${decision.escalatedCount} recurring risk(s) escalated to investigation`
        : "";
      console.log(`[sentinel] sweep complete: ${n} anomal${n === 1 ? "y" : "ies"}, ${r} emerging risk(s), ${decision.opened.length} incident(s) opened${escalatedSuffix}${failedSuffix}${redeemedSuffix}`);
    } catch (err) {
      const failedAt = new Date().toISOString();
      store.update((s) => {
        s.sentinel = {
          ...(s.sentinel || {}),
          status: "degraded",
          lastFailureAt: failedAt,
          lastError: errorRecord(err),
        };
      });
      console.error("[sentinel] sweep failed:", err.message);
    }
    const wait = Math.max(1000, intervalMs - (Date.now() - startedAt));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

module.exports = {
  sweepOnce, runDaemon, openIncidentFromInvestigation, attachRemediation,
  deriveConfidence, extractHeadline, extractResolutionSteps, hasOpenIncidentFor, errorRecord,
  escalatedRisks, RISK_ESCALATION_COUNT, RISK_ESCALATION_WINDOW_MS,
};

if (require.main === module) {
  require("../env").loadEnv();
  runDaemon().catch((err) => {
    console.error("[sentinel] daemon crashed:", err.stack || err.message);
    process.exitCode = 1;
  });
}
