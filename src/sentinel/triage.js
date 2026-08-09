// Reads the numeric frame from frame.js and decides — by the model's own judgement, never a
// hardcoded comparison — whether anything in the fleet right now deserves a closer look, and
// whether anything looks like trouble forming before it's an incident. This is the cheap, wide
// sweep; escalation into the expensive multi-turn investigator only happens when this call
// itself decides it's warranted. No threshold constant exists here on purpose: the whole point
// of this file is that "is this a problem" is a judgement call over evidence, not a comparison.

const { chat, MODELS } = require("../llm/client");

const SYSTEM_PROMPT = `
You are a fleet-triage sentinel for the OpenTelemetry Demo microservices system (18
services). You are given a numeric snapshot of every service: current error rate, error
rate one hour ago, current total call rate, error ratio, p95 latency in milliseconds, and a
count of recent error traces. No verdict has been applied to any of these numbers — deciding
what, if anything, looks anomalous is entirely your judgement. Compare each service's current
numbers against its own one-hour-ago baseline and against its peers; do not judge against any
fixed cutoff, because none of these numbers has a universal "bad" value — a healthy baseline
here is close to zero errors for most services, so even small absolute moves can be
meaningful, while a single low-traffic service can show a dramatic ratio swing from one
request that isn't actually a problem. Weigh ratio, absolute rate, and trace corroboration
together rather than reading any one number alone.

Respond with a JSON object, and nothing else, in exactly this shape:
{
  "anomalies": [
    { "service": "<name>", "reason": "<why this looks like a real problem worth investigating, citing the specific numbers you were given>" }
  ],
  "emergingRisks": [
    { "service": "<name>", "riskType": "<short label>", "reason": "<why this is trending toward trouble but isn't an incident yet, citing specific numbers>" }
  ]
}
Both arrays may be empty. Do not invent a service that isn't in the snapshot. Do not pad
either list to look thorough — on a genuinely quiet fleet, an empty "anomalies" array is the
correct, honest answer, not a failure to find something.
`.trim();

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`triage(): model did not return parseable JSON: ${String(text).slice(0, 300)}`);
    return JSON.parse(match[0]);
  }
}

// The grounding check: a hallucinated service name is the cheapest, most damaging kind of
// fabrication triage could produce — it would spawn a real investigation, and a real
// incident, for a service that was never in the frame it was handed at all. This is a
// deterministic membership check against the REAL service list the frame was built from
// (frame.perService), not a judgement about the world — it can only ever reject a name,
// never invent or approve a claim about a service's actual state. Every dropped entry is
// logged, never silently discarded, so a hallucination is a visible event, not a non-event.
function groundedIn(frame, items, label) {
  const realServices = new Set((frame?.perService || []).map((s) => s.service));
  const grounded = [];
  for (const item of items) {
    if (realServices.has(item.service)) {
      grounded.push(item);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`triage(): dropped a hallucinated ${label} for service "${item.service}" — not in the real frame`);
    }
  }
  return grounded;
}

async function triage(frame) {
  const res = await chat({
    model: MODELS.fast,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(frame, null, 2) }],
  });

  const parsed = extractJson(res.text);
  const anomalies = groundedIn(frame, Array.isArray(parsed.anomalies) ? parsed.anomalies : [], "anomaly");
  const emergingRisks = groundedIn(frame, Array.isArray(parsed.emergingRisks) ? parsed.emergingRisks : [], "emerging risk");

  return { anomalies, emergingRisks, raw: res.text };
}

module.exports = { triage, groundedIn, SYSTEM_PROMPT };
