// The investigator's reasoning loop — where the 6 tools in ./tools.js actually get used.
//
// investigate() hands the model a trigger, lets it drive the tool loop in src/llm/client.js
// (the only choke point for API calls in this whole system), and comes back with a cited RCA
// plus a hypothesis_history — a turn-by-turn record of what the model believed, what it did
// to try to prove itself wrong, and whether that attempt held up or forced a revision. That
// history, not just the final paragraph, is the audit trail for the malleability trait: a
// model that states one hypothesis and never revises it looks identical to one that never
// tried to disconfirm anything, unless the trail itself is captured.
//
// Nothing in this file decides what counts as anomalous — there is no threshold here, on
// purpose. The system prompt below asks the model to reason over evidence in prose; this
// file only plumbs tool calls to tools.js (which routes everything through the caller's
// Ledger, per CONTRACTS.md) and parses the model's own tagged hypothesis statements out of
// its replies.

const { chat, runToolLoop, MODELS } = require("../llm/client");
const { Ledger } = require("../evidence/ledger");
const tools = require("./tools");

// ---- System prompt ------------------------------------------------------------------------
// This is the load-bearing artifact in this file. It has to produce, from a single trigger
// and zero hand-holding: an explicit hypothesis, a genuine attempt to break that hypothesis
// (not just more confirming evidence), honest acknowledgement when a query contradicts it,
// and a final answer where every factual clause traces back to a real tool call.
//
// Deliberately absent: any literal fault-injection address. CONTRACTS.md bans reading the
// fault-flag control API from anywhere in src/, unconditionally — including strings inside a
// prompt — so the rule below is phrased generically (any toggle/control endpoint), never
// naming the address itself.
const SYSTEM_PROMPT = `
You are an SRE investigator diagnosing a live incident in a real, running microservices
system (OpenTelemetry Demo, "Astronomy Shop" — about 18 services including frontend,
frontend-proxy, checkout, cart, payment, product-catalog, currency, shipping,
recommendation, ad, and others) using ONLY the tools provided. Those tools are your only
senses. Each one queries real, live Mimir metrics, Loki logs, or Tempo traces and records
the exact query and response as a numbered evidence entry ([E1], [E2], ...) that you cite.

## Hypothesis discipline (read carefully — this is how your reasoning is graded)

Work like someone testing a hypothesis, not like someone building a case for a conclusion
you already believe.

1. As soon as you have any signal to hypothesize from, state an explicit hypothesis naming
   the service you believe is responsible and the mechanism you think is wrong. Tag it on
   its own line, exactly like this:
   HYPOTHESIS[NEW]: <service> — <what you think is wrong> — <[E#] citations if you already
   have evidence, or "no evidence yet" if this is a starting guess from the trigger alone>

2. Your next move after stating a hypothesis must be a query chosen because it COULD PROVE
   IT WRONG — not one that only piles on more confirming detail. Ask yourself "what would I
   see here if my hypothesis were false?" and query for exactly that. Examples of a genuine
   disconfirming move: checking whether OTHER services show the same symptom (would mean the
   service you named isn't uniquely responsible), checking whether the anomaly actually shows
   up in the metric/log/trace you'd expect if your mechanism were real, or comparing the
   current reading against its own recent baseline to rule out normal variance. Do not stop
   at the first query that happens to agree with you.

3. When a query result is inconsistent with your current hypothesis, say so out loud — never
   quietly change direction. Tag it:
   HYPOTHESIS[DISCONFIRMED]: <what you expected> vs <what [E#] actually showed>
   ...then immediately state what replaces it:
   HYPOTHESIS[REVISED]: <new service/mechanism> — <why, with [E#] citations>

4. When a disconfirming attempt instead FAILS to disconfirm — the evidence holds up — say
   that explicitly too:
   HYPOTHESIS[CONFIRMED]: <service> — <mechanism> — <[E#] citations of the evidence that
   survived your attempt to break it>

You may cycle through NEW -> attempted disconfirm -> CONFIRMED or REVISED more than once.
That cycle, not just your final paragraph, is what makes your conclusion trustworthy — always
emit the tag, even when you're confident, so the trail is complete.

## Evidence and citation rules — absolute, not stylistic

- Every factual claim you make about any metric value, log line, trace, span, or event must
  carry a citation to the real evidence id a tool call returned to you, e.g. [E7]. Use ids
  exactly as your tool results gave them to you.
- NEVER invent, guess, or renumber an evidence id. If a tool call in THIS conversation did
  not hand you that id, you have no citation for the claim — go get one, or don't make the
  claim.
- Any background context you were handed at the very start of this investigation is
  orientation only. It was not produced by a tool call in this session, so it is not yet
  citable — verify anything you intend to rely on with your own query before citing it.
- Every sentence in your final answer should survive someone asking "show me the evidence
  behind that."

## Hard boundaries

- Never reference, query, or reason about any fault-injection / feature-flag "toggle"
  control endpoint for this environment — anything whose job is to turn synthetic failures on
  or off from the outside. That control plane is a test harness, not telemetry, and is
  entirely off-limits; it must never factor into your diagnosis. (If exception text or a log
  line happens to name a flag, that IS legitimate telemetry — read it as evidence — but that
  does not make the control plane itself something to look for or call.)
- You decide what counts as anomalous by judgment over the evidence in front of you. There is
  no fixed number that makes something "a problem" — compare against baselines, compare
  services against each other, read the shape of the data, and reason about it in prose
  rather than against a cutoff.
- Self-correction applies to your own reasoning and to what you'd recommend doing about the
  target system — never to your own tools or evidence pipeline. An empty or errored query is
  information to reason about (absence of data is not evidence of health), never a reason to
  distrust the tools themselves or stop looking.

## Query defaults

Default error/latency investigation to traces_span_metrics_calls_total and
traces_span_metrics_duration_milliseconds_bucket — the only metric family every service in
this fleet emits; the native http_server_*/rpc_server_* histograms only cover a handful of
services and will silently miss faults elsewhere. Make error-rate queries absent-safe (some
services return zero SERIES, not a zero value, when healthy — those are different facts).
When you pull a full trace, its span EVENTS (not just span status) often carry the sharpest
root-cause text, including exception messages that can name the exact failing mechanism.

## Final answer format

When you're done, write your final message as the root-cause analysis, structured like this:

1. A 2-3 line headline: the responsible service, the mechanism, and your confidence — every
   factual clause cited. Someone reading only this should already know what's wrong.
2. "Evidence:" the handful of [E#] entries that matter most and what each one showed.
3. "Hypothesis trail:" one line per HYPOTHESIS tag you raised, in order, so the reader can
   see what you ruled out and why — not just the surviving conclusion.
4. "Recommended next steps:" concrete, ordered actions tied to what you actually found in
   THIS investigation, not a generic runbook. If the evidence doesn't support a confident
   root cause, say that plainly and name the next query that would resolve it, instead of
   guessing.

Lead with the headline; the rest is detail available on demand, not a wall of raw data
dumped up front.
`.trim();

// ---- Hypothesis parsing --------------------------------------------------------------------
// The model's own tagged lines ARE the hypothesis_history — we don't infer or paraphrase,
// we just pull out exactly what it wrote, per turn, so the trail can't drift from what was
// actually said.

const HYPOTHESIS_RE = /HYPOTHESIS\[(NEW|CONFIRMED|REVISED|DISCONFIRMED)\]\s*:\s*(.+)/gi;

function parseHypotheses(text, turn) {
  if (!text) return [];
  return [...String(text).matchAll(HYPOTHESIS_RE)].map((m) => ({
    turn,
    status: m[1].toUpperCase(),
    text: m[2].trim(),
  }));
}

// ---- Shaping tool results for the model -----------------------------------------------------
// tools.js returns { id, summary, raw, ...extracted } — `raw` is the untouched OTLP/Prometheus
// response, kept in the ledger entry for a human/judge to audit, but it is not what the model
// needs in its own context window. Sending it back turn after turn would balloon token cost
// for no reasoning benefit, since `summary` (and, for traces, the already-flattened fields)
// already say what the response means. This is a pagination-style bound on array size, not a
// judgement about what's anomalous — CONTRACTS.md's threshold rule is about "is this a
// problem", which stays entirely the model's call over the summaries/spans it's given.

function shapeToolResult(name, result) {
  const shaped = { id: result.id, summary: result.summary };

  if (name === "search_traces" || name === "search_traces_ql") {
    shaped.traces = result.traces || [];
  } else if (name === "get_trace") {
    const spans = result.spans || [];
    const notable = spans.filter(
      (s) => (s.events && s.events.length > 0) ||
        (s.status && s.status.code && s.status.code === "STATUS_CODE_ERROR"),
    );
    const other = spans.filter((s) => !notable.includes(s));
    shaped.spans = {
      notable,
      otherCount: other.length,
      // Bounded sample, name/service only — the full detail for any of these is available by
      // asking for this trace again or a more targeted query; nothing here hides evidence,
      // it's already in the ledger's `raw` for this evidence id.
      otherSample: other.slice(0, 15).map((s) => ({ spanId: s.spanId, name: s.name, serviceName: s.serviceName })),
    };
  }

  return shaped;
}

function buildHandlers(ledger) {
  const bound = {
    query_metrics: (args) => tools.query_metrics(args.promql, ledger),
    query_logs: (args) => tools.query_logs(args.logql, args.sinceMinutes, ledger),
    search_traces: (args) => tools.search_traces(args.tagFilter, args.limit, ledger),
    search_traces_ql: (args) => tools.search_traces_ql(args.traceql, args.limit, ledger),
    get_trace: (args) => tools.get_trace(args.traceId, ledger),
    compare_baseline: (args) => tools.compare_baseline(args.promql, args.minutes, ledger),
  };

  const handlers = {};
  for (const [name, fn] of Object.entries(bound)) {
    handlers[name] = async (args = {}) => shapeToolResult(name, await fn(args || {}));
  }
  return handlers;
}

// ---- Initial framing -----------------------------------------------------------------------

function buildInitialMessage(trigger, frame) {
  const parts = [`Investigation trigger: ${trigger}`];

  if (frame == null || (typeof frame === "string" && !frame.trim())) {
    parts.push("", "No pre-gathered context was provided — start from scratch using your tools.");
  } else if (typeof frame === "string") {
    parts.push(
      "",
      "Context already gathered by the caller (orientation only — not yet cited evidence; " +
        "verify anything you rely on with your own tool call before citing it):",
      frame.trim(),
    );
  } else {
    parts.push(
      "",
      "Context already gathered by the caller (orientation only — not yet cited evidence; " +
        "verify anything you rely on with your own tool call before citing it):",
      JSON.stringify(frame, null, 2),
    );
  }

  parts.push("", "Begin your investigation now.");
  return parts.join("\n");
}

// ---- Main entry point ----------------------------------------------------------------------
//
// `ledger` — pass the caller's own Ledger instance to scope citations to a specific
// incident/state object (per CONTRACTS.md's Ledger convention). If omitted, one is built from
// `state` (or, if that's also omitted, backed by the shared on-disk store).
// `frame`  — optional pre-gathered context (object or string); never itself treated as
// citable evidence, only orientation for the model's first move.
async function investigate({ trigger, frame = null, ledger = null, state = null, model = MODELS.fast, maxTurns = 12 } = {}) {
  if (!trigger || !String(trigger).trim()) {
    throw new Error("investigate() requires a non-empty `trigger` describing what to look into");
  }

  const activeLedger = ledger || new Ledger(state || null);
  const handlers = buildHandlers(activeLedger);
  const toolDefs = tools.toToolDefinitions();

  const hypothesis_history = [];
  const onStep = async (step) => {
    hypothesis_history.push(...parseHypotheses(step.text, step.turn));
  };

  const messages = [{ role: "user", content: buildInitialMessage(trigger, frame) }];

  const loopResult = await runToolLoop({
    model,
    system: SYSTEM_PROMPT,
    messages,
    tools: toolDefs,
    handlers,
    maxTurns,
    onStep,
  });

  let final_rca = loopResult.text;

  // Either maxTurns ran out mid tool-call, or the model closed a turn with no text for some
  // other reason. Force one more turn with no `tools` passed — it structurally cannot make
  // another tool call — rather than shipping an empty RCA.
  if (loopResult.exhausted || !final_rca || !final_rca.trim()) {
    const forced = await chat({
      model,
      system: SYSTEM_PROMPT,
      messages: [
        ...loopResult.messages,
        {
          role: "user",
          content:
            "You are out of further tool-call turns. Using only the evidence you already " +
            "gathered above (cite it by the [E#] ids already returned to you — never invent " +
            "new ones), write your final root-cause analysis now, in the required format. " +
            "Do not attempt to call any more tools.",
        },
      ],
    });
    final_rca = forced.text || final_rca || "";
    hypothesis_history.push(...parseHypotheses(final_rca, loopResult.steps.length));
  }

  const { cited, unresolved } = activeLedger.validate(final_rca);
  if (unresolved.length) {
    // An invented citation must surface, never reach an operator disguised as a real one.
    // eslint-disable-next-line no-console
    console.warn(`investigate(): model cited unresolved evidence ids: ${unresolved.join(", ")}`);
  }

  return {
    hypothesis_history,
    final_rca,
    citedEvidence: cited.filter((id) => !unresolved.includes(id)),
    unresolvedCitations: unresolved,
    turns: loopResult.steps.length,
    exhausted: Boolean(loopResult.exhausted),
  };
}

module.exports = { investigate, buildHandlers, shapeToolResult, parseHypotheses, buildInitialMessage, SYSTEM_PROMPT };

// ---- CLI harness ----------------------------------------------------------------------------
// node src/investigator/loop.js "<trigger text>"
// Runs a full live investigation and prints the hypothesis trail, final RCA, and the ledger
// entries behind every citation — the end-to-end proof that the loop produces a cited RCA
// from real tool calls, not a canned string.
if (require.main === module) {
  (async () => {
    const trigger = process.argv.slice(2).join(" ") ||
      "A sweep of the fleet noticed something worth a closer look. Figure out if there's a real incident, and if so, what's actually wrong and where.";

    console.log(`SRE_LLM_MODE=${process.env.SRE_LLM_MODE || "live"}`);
    console.log(`Trigger: ${trigger}\n`);

    const ledger = new Ledger();
    const result = await investigate({ trigger, ledger });

    console.log("=== Hypothesis history ===");
    if (!result.hypothesis_history.length) {
      console.log("(none captured — the model never emitted a HYPOTHESIS[...] tag)");
    }
    for (const h of result.hypothesis_history) {
      console.log(`[turn ${h.turn}] ${h.status}: ${h.text}`);
    }

    console.log(`\n=== Final RCA (turns used: ${result.turns}, exhausted: ${result.exhausted}) ===\n`);
    console.log(result.final_rca);

    console.log("\n=== Cited evidence ===");
    for (const id of result.citedEvidence) {
      const e = ledger.get(id);
      console.log(`${id} [${e?.kind}] ${e?.query}`);
      console.log(`   -> ${e?.summary}`);
    }
    if (result.unresolvedCitations.length) {
      console.log(`\n!!! UNRESOLVED CITATIONS (cited but no matching ledger entry): ${result.unresolvedCitations.join(", ")}`);
    }
  })().catch((err) => {
    console.error("investigate() failed:", err.stack || err.message);
    process.exitCode = 1;
  });
}
