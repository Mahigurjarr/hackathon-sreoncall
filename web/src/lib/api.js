// Thin fetch wrapper around the backend's read-only API (see src/web/server.js).
// No client-side judgement lives here either — this file only moves bytes.

const BASE = "/api";

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function getState() {
  return getJson("/state");
}

export function getEvidence(id) {
  return getJson(`/evidence/${encodeURIComponent(id)}`);
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
  return json;
}

// The three review decisions on a drafted fix. `approve` is the only one that reaches
// outside this machine — it opens a real PR on the onboarded repo.
export function approveProposal(id) {
  return postJson(`/proposals/${encodeURIComponent(id)}/approve`);
}

// Hands the reviewer's objection back to the agent, which re-authors the fix itself.
// Slow by nature (a full model call), so callers must show pending state.
export function reviseProposal(id, feedback) {
  return postJson(`/proposals/${encodeURIComponent(id)}/revise`, { feedback });
}

export function rejectProposal(id, reason) {
  return postJson(`/proposals/${encodeURIComponent(id)}/reject`, { reason });
}
