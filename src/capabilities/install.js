// Capability installation — the gap the reference SaaS platform never fills.
//
// reference/sreoncall/ has a "monitoring capability" concept, but the only way one ever
// gets attached to a service is a human hitting a form. Nothing there decides, on its
// own, which capability actually fits which service. This module is that decision.
//
// There is no lookup table here either (no `if (runtime === 'jvm') installs.push(...)`).
// For every service, the live-discovered characteristics from discover.js are handed to
// the model, which reasons about THIS service's actual facts and decides which of the
// candidate capabilities (if any) are warranted, in its own words, citing the numbers it
// was given. Two services with the same shape of facts will tend to get similar answers
// because the reasoning is grounded in those facts — not because a rule forces it — and a
// service with different facts (or no facts at all) gets a different, defensible answer.

"use strict";

const { chat, MODELS } = require("../llm/client");
const store = require("../store/state");

// Candidates offered to the model. These are *concepts to consider*, not a menu the code
// enforces — the prompt explicitly tells the model it may reject all of them or propose a
// capability id of its own that better fits what it was actually shown.
const CANDIDATE_CAPABILITIES = [
  {
    id: "resource-saturation-watch",
    concept:
      "Watches language-runtime saturation signals (heap/GC for JVM, goroutine/memstats for Go, " +
      "event-loop lag for Node, GC for .NET, GIL/RSS for CPython). Only possible at all if a " +
      "runtime was actually discovered for the service — there is nothing to watch otherwise.",
  },
  {
    id: "db-connection-pool-watch",
    concept:
      "Watches DB client operation duration / connection pool behavior. Only possible if the " +
      "service was actually observed emitting db_client_operation_duration_seconds_count — a " +
      "service with no DB client metrics has no pool to watch.",
  },
  {
    id: "error-rate-baseline-watch",
    concept:
      "Watches error rate AND error ratio against this service's own recent baseline (span " +
      "metrics status_code breakdown). Possible for every service since span metrics are " +
      "universal, but whether it is actually worth installing — versus noise for a service that " +
      "barely gets called, or redundant for one already covered by a more specific watch — is a " +
      "real judgment call, not a given.",
  },
  {
    id: "log-correlation-watch",
    concept:
      "Correlates log lines against trace/error activity for the service. Only possible if the " +
      "service was actually observed to have a live log stream — several services in this fleet " +
      "emit no logs at all, and 'no logs seen yet' is not proof there are none, so this should " +
      "only be installed where log presence was positively confirmed.",
  },
  {
    id: "latency-regression-watch",
    concept:
      "Watches p95/p99 latency for regression against recent history. Only meaningful if the " +
      "service actually serves requests (has SERVER spans) — a service with no SERVER span kind " +
      "isn't the one whose serving latency would regress.",
  },
];

const INSTALL_TOOL = {
  type: "function",
  function: {
    name: "install_capabilities",
    description:
      "Record which monitoring capabilities are actually warranted for this one service, based " +
      "solely on the discovered characteristics you were given. Return an empty installs array " +
      "if nothing is warranted — that is a legitimate answer, not a failure.",
    parameters: {
      type: "object",
      properties: {
        installs: {
          type: "array",
          description:
            "Zero or more capabilities to install for this service. Omit anything not " +
            "actually justified by the facts you were given.",
          items: {
            type: "object",
            properties: {
              capability: {
                type: "string",
                description:
                  "A short kebab-case capability id. Use one of the candidate ids if it " +
                  "genuinely fits this service, or invent your own id if none of the " +
                  "candidates capture what this service's facts actually call for.",
              },
              reasoning: {
                type: "string",
                description:
                  "Why THIS capability is warranted for THIS service. Must reference the " +
                  "specific discovered facts you were given (the actual runtime string, the " +
                  "actual hasDb/hasLogs booleans, the actual span kinds, the actual " +
                  "criticality label, the actual call-rate number) — not a generic template. " +
                  "Do not invent facts you were not given.",
              },
            },
            required: ["capability", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      required: ["installs"],
      additionalProperties: false,
    },
  },
};

function systemPrompt() {
  const menu = CANDIDATE_CAPABILITIES.map((c) => `- ${c.id}: ${c.concept}`).join("\n");
  return (
    "You are the capability-installation reasoner for an AI-native incident-response system " +
    "watching the OpenTelemetry Demo application (an e-commerce storefront, ~18 microservices). " +
    "You will be given the live-discovered characteristics of exactly ONE service — the actual " +
    "runtime(s) detected, whether it has a DB client, which span kinds it emits, its business " +
    "criticality label (if any), whether it has a live log stream, and its approximate call " +
    "rate. These facts came from real queries against the live telemetry stack moments ago; " +
    "treat them as ground truth and do not assume anything beyond them.\n\n" +
    "Decide which monitoring capabilities are actually warranted for THIS service. Candidate " +
    "concepts to consider (you may install none of them, some of them, several, or a capability " +
    "id of your own that better fits what you were shown — the list is not a checklist to " +
    "satisfy):\n" +
    menu +
    "\n\n" +
    "Rules:\n" +
    "- Never install a capability whose precondition the facts contradict (e.g. no " +
    "db-connection-pool-watch if hasDb is false; no resource-saturation-watch if runtime is " +
    "'unknown').\n" +
    "- Do not apply a numeric threshold to decide relevance (no 'install if callRate > X'). " +
    "Reason qualitatively about what the actual numbers mean for this specific service, and say " +
    "so in prose.\n" +
    "- A service with little or no discoverable signal (unknown runtime, no DB, no span kinds, " +
    "unknown criticality, unknown logs, null call rate) should usually get few or zero " +
    "installs — say that plainly rather than installing capabilities to fill the list.\n" +
    "- Every reasoning string must cite the actual values you were given for this service.\n\n" +
    "Call install_capabilities with your decision."
  );
}

function userPrompt(svc) {
  const facts = {
    service: svc.service,
    runtime: svc.runtime,
    hasDb: svc.hasDb,
    spanKinds: svc.spanKinds,
    criticality: svc.criticality,
    hasLogs: svc.hasLogs,
    approxCallRate: svc.approxCallRate,
  };
  return (
    "Discovered characteristics for this service, read live off the telemetry stack:\n" +
    JSON.stringify(facts, null, 2) +
    "\n\nDecide which capabilities (if any) are warranted for this service and call " +
    "install_capabilities."
  );
}

// One LLM call per service — the model reasons over that service's own facts each time,
// rather than a single batched call producing a table it might pattern-fill.
async function decideForService(svc) {
  const reply = await chat({
    model: MODELS.deep,
    system: systemPrompt(),
    messages: [{ role: "user", content: userPrompt(svc) }],
    tools: [INSTALL_TOOL],
    toolChoice: { type: "function", function: { name: "install_capabilities" } },
  });

  const call = reply.toolCalls.find((c) => c.name === "install_capabilities");
  if (!call) {
    // The model answered in prose instead of calling the tool. That is a real failure to
    // surface, not something to paper over with an invented empty result.
    throw new Error(
      `install_capabilities: model did not call the tool for service '${svc.service}'. ` +
        `Raw text: ${reply.text || "(empty)"}`,
    );
  }

  const installs = Array.isArray(call.args?.installs) ? call.args.installs : [];
  return installs.filter(
    (i) => i && typeof i.capability === "string" && typeof i.reasoning === "string",
  );
}

/**
 * For each discovered service, ask the model which monitoring capabilities are warranted
 * and why, then persist the decisions to store/state.json under `installs`.
 *
 * Re-running this for a given set of services replaces that set's prior install records
 * (rather than piling up duplicates on every re-run) — installs for services NOT present
 * in `discoveredServices` are left untouched. So passing a subset re-decides only that
 * subset; passing a topology with different facts produces visibly different records
 * because the record IS the model's reasoning over those facts.
 */
async function installCapabilities(discoveredServices) {
  const decisions = [];
  for (const svc of discoveredServices) {
    const installs = await decideForService(svc);
    const decided_at = new Date().toISOString();
    for (const install of installs) {
      decisions.push({
        service: svc.service,
        capability: install.capability,
        decided_at,
        reasoning: install.reasoning,
        evidenceIds: Array.isArray(svc.evidence) ? svc.evidence : [],
      });
    }
  }

  const touchedServices = new Set(discoveredServices.map((s) => s.service));
  store.update((state) => {
    if (!Array.isArray(state.installs)) state.installs = [];
    state.installs = state.installs.filter((rec) => !touchedServices.has(rec.service));
    state.installs.push(...decisions);
  });

  return decisions;
}

module.exports = { installCapabilities, CANDIDATE_CAPABILITIES };

if (require.main === module) {
  (async () => {
    const { discoverServices } = require("./discover");

    let discovered;
    const fixturePath = process.argv[2];
    if (fixturePath) {
      // Synthetic-topology test path: pass a JSON file of discovered-service records
      // instead of hitting the live stack, to prove the output changes with the input.
      console.log(`Using synthetic discovered-services fixture: ${fixturePath}\n`);
      discovered = JSON.parse(require("node:fs").readFileSync(fixturePath, "utf8"));
    } else {
      console.log("Running discoverServices() against the live stack...\n");
      discovered = await discoverServices();
    }

    console.log(`Deciding capabilities for ${discovered.length} service(s)...\n`);
    const installs = await installCapabilities(discovered);

    for (const i of installs) {
      console.log(`${i.service} -> ${i.capability}`);
      console.log(`  ${i.reasoning}`);
      console.log(`  evidence=[${i.evidenceIds.join(",")}]\n`);
    }
    console.log(`${installs.length} install record(s) written to store/state.json.`);
  })().catch((err) => {
    console.error("installCapabilities failed:", err.message);
    process.exitCode = 1;
  });
}
