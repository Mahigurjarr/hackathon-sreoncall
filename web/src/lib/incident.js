// Mirrors bin/sre's tolerant field lookups exactly (see its header comment) so the web
// dashboard and the CLI never disagree about what an incident record means. Kept as
// plain functions, not a class, since that's all bin/sre itself needed.

const TERMINAL_STATUSES = new Set(["resolved", "closed", "mitigated"]);

function firstDefined(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function firstArray(obj, keys) {
  for (const k of keys) {
    if (Array.isArray(obj?.[k]) && obj[k].length) return obj[k];
  }
  return [];
}

export function isOpen(inc) {
  return !TERMINAL_STATUSES.has(inc.status);
}

export function serviceOf(inc) {
  return firstDefined(inc, ["service", "target", "serviceName"]) || "unknown service";
}

export function confidenceOf(inc) {
  return firstDefined(inc, ["confidence", "confidenceLevel"]) || "unknown";
}

export function rcaOf(inc) {
  return firstDefined(inc, ["rca", "rootCause", "analysis", "diagnosis"]);
}

export function resolutionStepsOf(inc) {
  const arr = firstArray(inc, ["resolution", "resolutionSteps", "nextSteps", "ownership", "remediation"]);
  return arr.map((s) => (typeof s === "string" ? s : s.step || s.text || s.action || JSON.stringify(s)));
}

export function headlineOf(inc) {
  const explicit = firstDefined(inc, ["headline", "title", "summary"]);
  if (explicit) return explicit;
  return `${serviceOf(inc)} — ${inc.status || "open"}`;
}

export function timelineOf(inc) {
  const unified = firstArray(inc, ["timeline", "hypotheses"]);
  const hypothesisEvents = (unified.length ? unified : inc.revisions || []).map((e) => ({ ...e, kind: "hypothesis" }));
  const stepEvents = (inc.steps || []).map((e) => ({ ...e, kind: "step" }));
  const events = [...hypothesisEvents, ...stepEvents];
  events.sort((a, b) => (a.at ? new Date(a.at).getTime() : 0) - (b.at ? new Date(b.at).getTime() : 0));
  return events;
}

export function citedIdsIn(text) {
  if (!text) return [];
  return [...new Set([...String(text).matchAll(/\[(E\d+)\]/g)].map((m) => m[1]))];
}

// Renders text with [E7]-style citations split out as tokens the UI can turn into
// clickable evidence chips, e.g. [{text: "..."}, {citation: "E7"}, {text: "..."}].
export function splitCitations(text) {
  if (!text) return [];
  const parts = [];
  let lastIndex = 0;
  for (const m of String(text).matchAll(/\[(E\d+)\]/g)) {
    if (m.index > lastIndex) parts.push({ text: text.slice(lastIndex, m.index) });
    parts.push({ citation: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });
  return parts;
}

export const SEVERITY_FROM_CONFIDENCE = {
  high: "critical",
  medium: "high",
  low: "medium",
  unknown: "low",
};
