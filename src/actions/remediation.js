// Turns a finished investigation into a concrete, reviewable change on the onboarded repo.
//
// This is the Ownership trait's load-bearing file. Everything it produces — whether a fix is
// even warranted, which files change, what goes in them, what the PR says — is decided by the
// model in draftRemediation() below. There is no template, no if/else mapping "service X ->
// runbook Y", and no fallback that emits a generic runbook when the model declines. Delete the
// chat() call and this module cannot produce a single line of a PR.
//
// It deliberately stops at a *draft*. Writing to GitHub is a separate, explicit step
// (proposals.applyGithubPrProposal) gated on approval — the same draft-then-approve shape
// reference/sreoncall uses for propose_change. An agent that opened PRs straight off its own
// conclusion would be reckless, not autonomous.
//
// Scope boundary, enforced by the prompt and re-checked in code below: the model may only
// touch SRE-as-code artifacts (alert rules, runbooks, SLOs) and docs in the onboarded repo.
// It must never propose edits to this agent's own observability pipeline — muting an alert or
// narrowing a collector to make a symptom disappear is self-blinding, not remediation.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runDecisionLoop, MODELS } = require("../llm/client");
const { Ledger } = require("../evidence/ledger");
const { practicesBlock } = require("../practices");
const { draftProposal } = require("./proposals");
const tools = require("../investigator/tools");

// Evidence-gathering turns before the author must decide. Small on purpose: this runs after
// a full investigation already happened, so the remaining work is usually one or two targeted
// queries (typically derive_baseline for an alert rule) — not a fresh search.
const MAX_AUTHOR_TURNS = 6;

function evidenceHandlers(ledger) {
  return {
    query_metrics: (a) => tools.query_metrics(a.promql, ledger).then(shapeForModel),
    compare_baseline: (a) => tools.compare_baseline(a.promql, a.minutes, ledger).then(shapeForModel),
    derive_baseline: (a) => tools.derive_baseline(a.promql, a.lookbackHours, ledger).then(shapeForModel),
  };
}

// Keep only what the author needs back — id (to cite) and summary/stats — never the raw
// response; that stays in the ledger for a human to audit, not in the model's context window.
function shapeForModel(result) {
  return { id: result.id, summary: result.summary, ...(result.stats ? { stats: result.stats } : {}) };
}

const EVIDENCE_TOOL_NAMES = new Set(["query_metrics", "compare_baseline", "derive_baseline"]);
const EVIDENCE_TOOLS = tools.toToolDefinitions().filter((t) => EVIDENCE_TOOL_NAMES.has(t.function.name));

const REPO_ROOT = path.join(__dirname, "..", "..");
const SRE_AS_CODE = path.join(REPO_ROOT, "sre-as-code");

// Paths the agent is allowed to create or modify. Anything outside this list is rejected in
// code, not just discouraged in the prompt — a model that tries to edit src/ (its own senses)
// or .env must fail closed rather than rely on having read the instruction.
const ALLOWED_PREFIXES = ["sre-as-code/", "docs/incidents/"];

function isAllowedPath(p) {
  const normalized = String(p).replace(/^\.\//, "");
  if (normalized.includes("..")) return false;
  return ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Reads the current SRE-as-code artifacts so the model can *amend* what already exists
 * instead of proposing a near-duplicate file beside it. Content is truncated per file — the
 * model needs the shape and the existing rule/step text, not every byte.
 */
function readSreAsCodeInventory(maxCharsPerFile = 2500) {
  const inventory = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ya?ml|md)$/.test(entry.name)) {
        const rel = path.relative(REPO_ROOT, full);
        const content = fs.readFileSync(full, "utf8");
        inventory.push({
          path: rel,
          content: content.length > maxCharsPerFile ? `${content.slice(0, maxCharsPerFile)}\n# ...(truncated)` : content,
        });
      }
    }
  };
  walk(SRE_AS_CODE);
  return inventory;
}

/**
 * Resolves the [E#] ids the RCA actually cited into their real ledger entries, so the model
 * writing the PR sees the same evidence the diagnosis rested on — and can quote the exact
 * query in the PR body rather than paraphrasing a claim it can't back up.
 */
function citedEvidenceFor(incident, ledger) {
  const ids = [...new Set([...String(incident.rca || "").matchAll(/\[(E\d+)\]/g)].map((m) => m[1]))];
  return ids
    .map((id) => {
      const entry = ledger.get(id);
      if (!entry) return null;
      return { id, kind: entry.kind, query: entry.query, summary: entry.summary };
    })
    .filter(Boolean);
}

const SYSTEM_PROMPT = `
You are the remediation author for an autonomous SRE agent. An investigation has just
concluded with a cited root-cause analysis. Your job is to decide whether that conclusion
justifies a concrete change to the team's SRE-as-code repository, and if so, to write that
change in full.

## Gathering evidence before you decide

You have query_metrics, compare_baseline, and derive_baseline available. Use them when the
fix you're considering is an alert rule — an alert rule with a real threshold-shaped condition
must be backed by derive_baseline's actual computed mean/stddev/percentiles from real history,
never a number you picked. If the RCA's own citations already establish the mechanism clearly
enough that no new query is needed, decide immediately — these tools exist to let you compute
a real number when a rule needs one, not to pad out every decision with busywork.

## What you are allowed to change

ONLY these paths:
- sre-as-code/alert-rules/*.yaml   — a signal that would have caught this incident earlier
- sre-as-code/runbooks/*.yaml      — the ordered procedure for THIS specific failure mode
- sre-as-code/slos/*.yaml          — an objective this incident showed to be missing or wrong
- docs/incidents/*.md              — a post-incident writeup

You may create new files or rewrite existing ones. When something close already exists,
AMEND it — do not drop a near-duplicate next to it. You are given the current contents.

## What you must never change

Never propose a change that reduces what the agent can see. Do not mute, delete, loosen, or
narrow an alert rule, a query, or a collector so that a symptom stops showing up. Do not
touch src/, bin/, .env, or anything in the agent's own observability path. Making the
telemetry quieter is not a fix — it is blinding the agent, and it is strictly forbidden even
if the alert genuinely is noisy. If an existing rule is too noisy, the correct proposal is a
*more precise* signal, never a suppressed one.

## When NOT to propose a change

Call \`no_code_fix\` when a repo change is genuinely not the right answer, and say why. This
is a real, expected outcome, not a failure — reach for it when:
- the root cause is an operator/flag/config action in the running system (e.g. the traced
  exception names a feature-flag fault), so a repo change would paper over something nobody
  needed to change in code;
- confidence in the root cause is too low to justify committing anything;
- the existing alert rules and runbooks already cover this exact failure mode adequately.

Do not invent busywork to look productive. A well-argued \`no_code_fix\` is a better answer
than a redundant runbook.

## Evidence rules — the same standard as the investigation

- Every factual claim in the PR body and in any \`rationale:\` field you write must cite the
  real evidence id it rests on, e.g. [E7], taken from the cited evidence you were given.
- Never invent an evidence id. If you weren't handed it, you cannot cite it.
- Match the existing files' style exactly: the alert rules carry a \`rationale:\` block
  explaining why that metric family and not another, and they deliberately encode NO static
  numeric threshold — whether a reading is anomalous is a live judgement the investigating
  agent makes against a baseline. Preserve that convention.
- If the rule's PromQL needs a comparison at all, express it against the query's OWN history
  (an \`offset\` comparison, or a derive_baseline-computed mean/stddev/percentile you actually
  called for and cite by [E#]) — never a bare literal number pulled from nowhere. A number in
  a rule with no [E#] beside it is a hardcoded threshold wearing a rationale as camouflage.

## PR body format

Lead with 2-3 lines a reviewer can act on: what broke, what this PR changes, why. Then the
cited evidence, then what this does NOT fix. Keep it tight — a reviewer should understand
the change before scrolling.
`.trim();

// Same pattern as the investigator: the team's own remediation discipline and guardrails are
// read off disk at call time and appended, so editing sre-as-code/practices/*.md changes what
// the agent is willing to propose without a code change.
function systemPrompt() {
  const practices = practicesBlock();
  return practices ? `${SYSTEM_PROMPT}\n\n---\n\n${practices}` : SYSTEM_PROMPT;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "propose_fix",
      description:
        "Propose a concrete change to the SRE-as-code repo that addresses this incident. Only call this when a repo change is genuinely warranted.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "PR title — specific to this incident, not generic." },
          branchSlug: {
            type: "string",
            description: "Short kebab-case branch suffix, e.g. 'product-catalog-error-alert'. No spaces or slashes.",
          },
          summary: {
            type: "string",
            description: "One or two sentences a human sees before opening the diff: what this changes and why.",
          },
          body: { type: "string", description: "Full PR description in markdown, with [E#] citations." },
          files: {
            type: "array",
            description: "The complete new content of every file this PR adds or rewrites.",
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "Repo-relative path, e.g. sre-as-code/alert-rules/cart-latency.yaml" },
                content: { type: "string", description: "The ENTIRE file content after the change, not a diff." },
                message: { type: "string", description: "Commit message for this file." },
              },
              required: ["path", "content"],
            },
          },
        },
        required: ["title", "branchSlug", "summary", "body", "files"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "no_code_fix",
      description: "Decline to propose a repo change, with the reason. A legitimate, expected outcome.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why a repo change is not the right response to this incident, with [E#] citations where relevant.",
          },
        },
        required: ["reason"],
      },
    },
  },
];

function buildUserMessage(incident, evidence, inventory) {
  return [
    `Incident ${incident.id} — service: ${incident.service || "unknown"} — confidence: ${incident.confidence || "unknown"}`,
    "",
    "## Root-cause analysis (already produced and cited by the investigating agent)",
    incident.rca || "(none recorded)",
    "",
    "## The evidence entries that RCA cited (these are the only ids you may cite)",
    evidence.length
      ? evidence.map((e) => `${e.id} [${e.kind}] query: ${e.query}\n   -> ${e.summary}`).join("\n")
      : "(the RCA cited no resolvable evidence — factor that into your confidence)",
    "",
    "## Current SRE-as-code files in the repo (amend these rather than duplicating them)",
    inventory.length
      ? inventory.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")
      : "(none yet)",
    "",
    "Decide now: call propose_fix with the complete change, or no_code_fix with your reason.",
  ].join("\n");
}

// Every evidence-gathering call the author makes goes through this ledger, so a derived
// baseline gets a real [E#] id the PR body can cite — the same ledger the investigation used,
// so ids keep counting up rather than colliding with the RCA's own [E#]s.
function newlyGatheredIds(gathered) {
  return gathered.map((g) => g.result?.id).filter(Boolean);
}

/**
 * Asks the model to author a remediation for `incident`. It may call query_metrics /
 * compare_baseline / derive_baseline first to gather real evidence (typically a historical
 * baseline for an alert rule) before deciding. Returns either
 * `{ kind: 'github_pr', proposal }` (a draft recorded in state.proposals, awaiting approval)
 * or `{ kind: 'no_code_fix', reason }`.
 *
 * Throws if the model never reaches a decision — an unparseable answer must surface rather
 * than silently become "no fix needed", which would look identical to a considered decline.
 */
async function draftRemediation(incident, { ledger = null, model = MODELS.deep } = {}) {
  if (!incident || !incident.id) throw new Error("draftRemediation() requires an incident with an id");

  const activeLedger = ledger || new Ledger();
  const evidence = citedEvidenceFor(incident, activeLedger);
  const inventory = readSreAsCodeInventory();

  const { call, gathered } = await runDecisionLoop({
    model,
    system: systemPrompt(),
    messages: [{ role: "user", content: buildUserMessage(incident, evidence, inventory) }],
    tools: [...EVIDENCE_TOOLS, ...TOOLS],
    handlers: evidenceHandlers(activeLedger),
    terminalTools: ["propose_fix", "no_code_fix"],
    maxTurns: MAX_AUTHOR_TURNS,
  });

  const allEvidenceIds = [...new Set([...evidence.map((e) => e.id), ...newlyGatheredIds(gathered)])];

  if (call.name === "no_code_fix") {
    const reason = await repairCitations(`draftRemediation(${incident.id})`, activeLedger, call.args.reason);
    return { kind: "no_code_fix", reason: reason || "(no reason given)", incidentId: incident.id };
  }

  const { title, branchSlug, summary, files } = call.args;

  if (!Array.isArray(files) || !files.length) {
    throw new Error(`draftRemediation(${incident.id}): propose_fix returned no files`);
  }

  // Fail closed on scope. The prompt forbids touching the agent's own senses; this enforces it.
  const outOfScope = files.filter((f) => !isAllowedPath(f.path));
  if (outOfScope.length) {
    throw new Error(
      `draftRemediation(${incident.id}): proposed files outside the allowed paths: ${outOfScope
        .map((f) => f.path)
        .join(", ")}`
    );
  }

  const body = await repairCitations(`draftRemediation(${incident.id})`, activeLedger, call.args.body);

  const slug = String(branchSlug || "fix").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const branchName = `agent/${incident.id.toLowerCase()}-${slug}`.slice(0, 200);

  const proposal = draftProposal({
    kind: "github_pr",
    summary: summary || title,
    payload: {
      incidentId: incident.id,
      service: incident.service,
      branchName,
      title,
      body,
      files: files.map((f) => ({
        path: f.path,
        content: f.content,
        message: f.message || `${title} (${incident.id})`,
      })),
      citedEvidence: allEvidenceIds,
    },
  });

  return { kind: "github_pr", proposal };
}

// Same standard as investigate()'s own final RCA: an invented citation gets one real repair
// attempt (Ledger.repair) before this text ships, not just a warning while it passes through
// unchanged. Returns the repaired text — callers store this, not the original.
async function repairCitations(label, ledger, text) {
  const result = await ledger.repair(text || "");
  if (result.stillUnresolved.length) {
    // eslint-disable-next-line no-console
    console.warn(`${label}: unresolved citations survived repair: ${result.stillUnresolved.join(", ")}`);
  }
  return result.text;
}

/**
 * Re-authors an existing draft in light of a human's objection.
 *
 * This is malleability made concrete rather than claimed: the reviewer argues in prose, and
 * the model rewrites its own proposed action — new files, new body, new reasoning — instead
 * of the human hand-editing a field. The prior version is kept in `revisions[]` so the
 * disagreement and what it changed stay auditable after the fact.
 *
 * Only draft-stage proposals can be revised; once a PR is open, the revision belongs on the
 * PR itself, not silently under it.
 */
async function reviseRemediation(proposal, feedback, { model = MODELS.deep } = {}) {
  if (!proposal || proposal.kind !== "github_pr") {
    throw new Error("reviseRemediation() expects a 'github_pr' proposal");
  }
  if (!["draft", "revised"].includes(proposal.status)) {
    throw new Error(
      `proposal '${proposal.id}' is '${proposal.status}' — only a draft can be revised, not one already ${proposal.status}`
    );
  }

  const { incidentId } = proposal.payload;
  const state = require("../store/state").load();
  const incident = (state.incidents || []).find((i) => i.id === incidentId);
  const ledger = new Ledger();
  const evidence = incident ? citedEvidenceFor(incident, ledger) : [];
  const inventory = readSreAsCodeInventory();

  const userMessage = [
    incident
      ? buildUserMessage(incident, evidence, inventory)
      : `The originating incident ${incidentId} is no longer in the store; reason from the proposal below alone.`,
    "",
    "## The change you previously proposed",
    `Title: ${proposal.payload.title}`,
    `Summary: ${proposal.summary}`,
    "",
    proposal.payload.files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n"),
    "",
    "## A reviewer rejected that draft with this objection",
    String(feedback).trim(),
    "",
    "Take the objection seriously — it may be right. Re-decide from scratch: call propose_fix",
    "with a genuinely revised change that answers it, or no_code_fix if the objection shows a",
    "repo change was the wrong response after all. Do not simply restate your previous draft.",
  ].join("\n");

  const { call, gathered } = await runDecisionLoop({
    model,
    system: systemPrompt(),
    messages: [{ role: "user", content: userMessage }],
    tools: [...EVIDENCE_TOOLS, ...TOOLS],
    handlers: evidenceHandlers(ledger),
    terminalTools: ["propose_fix", "no_code_fix"],
    maxTurns: MAX_AUTHOR_TURNS,
  });
  const newIds = newlyGatheredIds(gathered);

  // store.update()'s callback runs synchronously (see store/state.js), so the repair call —
  // which needs the network — has to resolve BEFORE update() runs, not inside it.
  const withdrawnReason =
    call.name === "no_code_fix"
      ? await repairCitations(`reviseRemediation(${proposal.id})`, ledger, call.args.reason)
      : null;
  const repairedBody =
    call.name === "propose_fix"
      ? await repairCitations(`reviseRemediation(${proposal.id})`, ledger, call.args.body)
      : null;

  const { update } = require("../store/state");
  let updated;

  update((s) => {
    const p = (s.proposals || []).find((x) => x.id === proposal.id);
    if (!p) throw new Error(`proposal '${proposal.id}' vanished from the store mid-revision`);

    p.revisions = p.revisions || [];
    p.revisions.push({
      at: new Date().toISOString(),
      feedback: String(feedback).trim(),
      previous: { summary: p.summary, payload: p.payload },
    });

    if (call.name === "no_code_fix") {
      p.status = "withdrawn";
      p.withdrawnReason = withdrawnReason || "(no reason given)";
      p.summary = `Withdrawn after review: ${p.withdrawnReason}`;
    } else {
      const { title, summary, files } = call.args;
      const outOfScope = (files || []).filter((f) => !isAllowedPath(f.path));
      if (outOfScope.length) {
        throw new Error(`revision proposed files outside the allowed paths: ${outOfScope.map((f) => f.path).join(", ")}`);
      }
      p.status = "revised";
      p.summary = summary || title;
      p.payload = {
        ...p.payload,
        title,
        body: repairedBody,
        files: (files || []).map((f) => ({
          path: f.path,
          content: f.content,
          message: f.message || `${title} (${incidentId})`,
        })),
        citedEvidence: [...new Set([...(p.payload.citedEvidence || []), ...newIds])],
      };
    }
    updated = p;
  });

  return updated;
}

module.exports = {
  draftRemediation, reviseRemediation, readSreAsCodeInventory, citedEvidenceFor,
  isAllowedPath, ALLOWED_PREFIXES,
};
