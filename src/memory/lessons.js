// The broader human-correction loop — self-learning that outlives a single incident.
//
// src/actions/redemption.js already closes the loop PER INCIDENT: did this specific fix hold,
// and should THIS specific mechanism be reused. What was missing is the wider one: when a
// human corrects the agent — rejects a proposal outright, or pushes back on one with an
// objection — does that correction teach the agent something that should change how it
// authors EVERY future proposal, not just avoid repeating this one exact fix?
//
// Two trigger points, one judgement: src/web/server.js calls extractLesson() after both a
// `reject` (action: "rejected") and a `revise`/push-back (action: "pushed back on"). A
// push-back is often the richer of the two — the human's objection AND the agent's revised
// response are both visible, not just a bare rejection reason.
//
// The mechanism: the feedback is handed to the model to judge — is there a genuine, general
// principle here, or was this just a one-off disagreement with a judgement call? A real lesson
// gets appended to sre-as-code/practices/learned-lessons.md, which src/practices.js loads into
// EVERY future reasoning step (investigation, remediation authoring, redemption). That is what
// makes this "wider behaviour retuning" rather than another incident-scoped memory: the file is
// read by every subsequent incident, not just ones recall judges related to this one.
//
// A well-argued "no lesson" is a correct, expected outcome — manufacturing a rule from a single
// correction that was really just a one-off judgement call would pollute the practice doc with
// noise, and noise in a file loaded into every future prompt is worse than not having the file.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chat, MODELS } = require("../llm/client");

const LESSONS_PATH = path.join(__dirname, "..", "..", "sre-as-code", "practices", "learned-lessons.md");

const HEADER = `# Learned lessons

Durable, general principles extracted from real human corrections — not incident-specific
notes (those live on the incident itself), but lessons judged general enough to change how
EVERY future incident gets handled. Loaded into every reasoning step by src/practices.js,
exactly like the other practice docs.

Appended automatically by src/memory/lessons.js when a human rejects a proposal AND the model
judges the rejection reveals a genuine, general gap — not on every rejection, since a
well-argued "no lesson" is the correct outcome for a one-off disagreement. This file is meant
to be periodically read and pruned by a human the same way any other practice doc is; treat an
entry here as a starting draft of a rule, not untouchable history.
`;

const SYSTEM_PROMPT = `
You extract a durable, GENERAL lesson from one specific piece of human feedback on a proposal
the agent authored — either an outright rejection, or a "push back" where the human objected
and the agent re-authored its response. Your job is not to summarize what happened; it's to
decide whether this feedback reveals a principle that should change how the agent behaves on
EVERY future incident like it, not just this one.

A push-back is often the richer signal of the two: the human's objection AND the agent's
revised attempt are both visible, so you can judge not just what was wrong but whether the
underlying reasoning pattern is likely to recur. Judge it with the same conservatism as a
rejection — don't record a lesson just because a revision happened; most revisions are
successfully self-correcting in the moment and don't reveal anything that needs to change
beyond that one incident.

Call record_lesson only when there is a genuine, generalizable takeaway — something like "don't
propose an alert rule when the RCA's confidence is medium or below without saying so plainly in
the rationale" is a real lesson; "the human just preferred a different phrasing" is not.

Call no_lesson when the feedback is a one-off judgement call, a disagreement about this
specific incident's facts, or too thin to generalize from safely. This is the common, correct
outcome — most single pieces of feedback do not reveal a systemic gap, and a manufactured rule
from one data point pollutes a file every future incident gets reasoned against. Be conservative
in the same spirit as memory/recall.js's reuse judgement: a wrong "lesson" is more expensive
than a missed one.
`.trim();

const TOOLS = [
  {
    type: "function",
    function: {
      name: "record_lesson",
      description: "Record a durable, general lesson this rejection reveals.",
      parameters: {
        type: "object",
        properties: {
          lesson: { type: "string", description: "The general principle, stated as an instruction for future incidents." },
          appliesTo: { type: "string", description: "What kind of situation this applies to — be specific enough to be checkable later." },
        },
        required: ["lesson", "appliesTo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "no_lesson",
      description: "Decline to record a lesson — this rejection doesn't generalize. The common, correct outcome.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why this doesn't generalize." },
        },
        required: ["reason"],
      },
    },
  },
];

// `action` is "rejected" or "pushed back on" — the framing has to be accurate about what
// actually happened. A push-back is not a rejection: the agent got another chance and (per
// reviseRemediation) already re-authored something in response. The feedback that prompted
// that re-authoring is still a genuine human correction, and often a richer one than a flat
// rejection — the reviewer explains what's wrong AND the agent's revised attempt shows
// whether it understood, which a bare rejection reason alone doesn't reveal.
function buildUserMessage(proposal, reason, action) {
  return [
    `A human ${action} this proposal:`,
    "",
    `Title: ${proposal.payload?.title || proposal.summary}`,
    `Summary: ${proposal.summary}`,
    proposal.payload?.body ? `\nBody:\n${proposal.payload.body}` : "",
    "",
    `## The ${action === "rejected" ? "rejection" : "pushback"} feedback`,
    String(reason || "(no reason given)").trim(),
    "",
    "Decide now: record_lesson if this generalizes, or no_lesson if it doesn't.",
  ].join("\n");
}

/**
 * Appends a lesson to the learned-lessons practice file. Creates the file with its header on
 * first use. Plain synchronous append — this path is human-paced (a rejection happens at most
 * a few times per session, never in a hot loop), so the heavier cross-process lock
 * store/state.js needs for high-frequency incident writes would be unjustified machinery here.
 */
// Loaded into EVERY future reasoning step (practices.js) — a file that quietly grows forever
// degrades every future prompt's quality, not just this one's. This is a soft, visible signal
// (a log line), never a silent auto-prune: the file is explicitly human-curated (see its own
// HEADER), and deleting someone's accumulated practice without asking is a worse failure mode
// than a slightly-too-long file. 8000 chars is roughly 30-40 entries at this format's size —
// generous headroom before it's actually a prompt-bloat problem, early enough to act on it.
const SIZE_WARNING_BYTES = 8000;

function appendLesson({ lesson, appliesTo, fromProposalId, action = "rejected" }) {
  if (!fs.existsSync(LESSONS_PATH)) {
    fs.mkdirSync(path.dirname(LESSONS_PATH), { recursive: true });
    fs.writeFileSync(LESSONS_PATH, HEADER);
  }
  const entry = [
    "",
    `## ${new Date().toISOString()} — from ${fromProposalId} (${action})`,
    "",
    `**Applies to:** ${appliesTo}`,
    "",
    lesson,
    "",
  ].join("\n");
  fs.appendFileSync(LESSONS_PATH, entry);

  const size = fs.statSync(LESSONS_PATH).size;
  if (size > SIZE_WARNING_BYTES) {
    console.warn(
      `[lessons] learned-lessons.md is now ${size} bytes — this is loaded into every future ` +
        "prompt; consider a human pass to prune or consolidate older entries."
    );
  }
}

/**
 * Judges whether a piece of human feedback (a rejection, or a push-back's objection) reveals a
 * general lesson, and if so, records it durably.
 *
 * `action` is `"rejected"` or `"pushed back on"` — only affects how the prompt frames what
 * happened, not the judgement's conservatism, which stays identical either way.
 *
 * Returns `{ recorded: boolean, lesson?, appliesTo?, reason? }`. Never throws — a failed
 * extraction call must not turn a successful reject/revise into a server error; that action
 * already happened and is already stored on the proposal regardless of whether a broader
 * lesson could be drawn from it.
 */
async function extractLesson(proposal, reason, { model = MODELS.fast, action = "rejected" } = {}) {
  try {
    const reply = await chat({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(proposal, reason, action) }],
      tools: TOOLS,
      toolChoice: "required",
    });

    const call = reply.toolCalls[0];
    if (!call || call.name === "no_lesson") {
      return { recorded: false, reason: call?.args?.reason || "no usable verdict" };
    }

    const { lesson, appliesTo } = call.args;
    if (!lesson || !lesson.trim()) return { recorded: false, reason: "model called record_lesson with an empty lesson" };

    appendLesson({ lesson, appliesTo: appliesTo || "(unspecified)", fromProposalId: proposal.id, action });
    return { recorded: true, lesson, appliesTo };
  } catch (err) {
    console.error(`extractLesson(${proposal.id}): failed — ${err.message}`);
    return { recorded: false, reason: `extraction failed: ${err.message}` };
  }
}

module.exports = { extractLesson, appendLesson, LESSONS_PATH };
