// Loads the team's SRE practice and guardrail documents and hands them to the reasoning
// steps that need them.
//
// Why these live in sre-as-code/practices/*.md rather than as string literals in the prompts:
// they are the agent's operating procedure, and an operating procedure should be reviewable,
// diffable, and changeable by the on-call team without touching source. Editing
// incident-response.md changes how the agent investigates the very next incident — that is
// the malleability trait applied to the agent's own behaviour, not just to a single
// conclusion.
//
// Read fresh on each call, deliberately. The daemon is a long-lived process; caching would
// mean an edit to the practice docs didn't take effect until a restart, which is exactly the
// feedback loop this design exists to make tight.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PRACTICES_DIR = path.join(__dirname, "..", "sre-as-code", "practices");

// Order matters: guardrails last, so the hard limits are the final thing in the prompt
// rather than something earlier text can appear to soften. learned-lessons sits between the
// two — it's practice guidance like incident-response.md, just accumulated from real human
// corrections (src/memory/lessons.js) instead of authored up front.
const DOCS = [
  { file: "incident-response.md", title: "Incident response practice (team-authored)" },
  { file: "learned-lessons.md", title: "Learned lessons (accumulated from human corrections)" },
  { file: "guardrails.md", title: "Guardrails — hard limits, not guidance" },
];

function readDoc(file) {
  try {
    return fs.readFileSync(path.join(PRACTICES_DIR, file), "utf8").trim();
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Returns the practice documents as a single block for prompt injection, or "" if none are
 * present. Never throws on a missing file: the practice docs sharpen the agent's behaviour,
 * but their absence must degrade reasoning quality, not take the daemon down mid-incident.
 */
function practicesBlock({ include = DOCS } = {}) {
  const sections = [];
  for (const doc of include) {
    const text = readDoc(doc.file);
    if (!text) continue;
    sections.push(`## ${doc.title}\n\n${text}`);
  }
  if (!sections.length) return "";

  return [
    "# Your team's operating procedure",
    "",
    "The following is authored and maintained by the on-call team you work for. It is not",
    "background reading — follow it. Where it is more specific than your general instructions,",
    "it wins. The guardrails section is absolute: no incident, however urgent, justifies",
    "crossing it.",
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}

/** Which practice docs were actually found — surfaced in the dashboard so a missing one is visible. */
function loadedPractices() {
  return DOCS.map((doc) => ({ file: doc.file, title: doc.title, present: readDoc(doc.file) !== null }));
}

module.exports = { practicesBlock, loadedPractices, PRACTICES_DIR, DOCS };
