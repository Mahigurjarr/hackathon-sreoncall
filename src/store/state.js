// Single-file JSON store. No database — the whole point is that a judge can open
// store/state.json and read the agent's entire memory in plain text.

const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = path.join(__dirname, "..", "..", "store", "state.json");

const EMPTY = { incidents: [], evidence: [], installs: [], traces: [], lastSweep: null, emergingRisks: [] };

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) };
  } catch (err) {
    if (err.code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave truncated JSON behind.
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

function update(fn) {
  const state = load();
  fn(state);
  save(state);
  return state;
}

function newIncident(fields = {}) {
  let created;
  update((state) => {
    created = {
      id: `INC-${state.incidents.length + 1}`,
      status: "open",
      openedAt: new Date().toISOString(),
      openedBy: "sentinel",
      evidence: [],
      revisions: [],
      steps: [],
      ...fields,
    };
    state.incidents.push(created);
  });
  return created;
}

module.exports = { load, save, update, newIncident, STATE_PATH };
