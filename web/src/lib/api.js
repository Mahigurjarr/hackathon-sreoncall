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
