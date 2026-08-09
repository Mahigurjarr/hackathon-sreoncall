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

// Cross-process mutex around read-modify-write.
//
// The sentinel and the web API are separate processes (separate containers, sharing the
// store via a bind mount). Both call update(): the daemon writes sweep results, the API
// writes proposal approvals. Without a lock, load() → mutate → save() from two processes
// interleaves and the second save silently discards the first's changes — losing, say, an
// approved PR because a sweep finished a millisecond later.
//
// O_EXCL create is atomic on both local filesystems and Docker bind mounts, which is all
// this needs. A lock older than STALE_MS is broken on the assumption its holder crashed —
// without that, one hard kill would wedge every writer forever.
const LOCK_PATH = `${STATE_PATH}.lock`;
const STALE_MS = 15000;
const RETRY_MS = 25;
const MAX_WAIT_MS = 10000;

function sleepSync(ms) {
  // Deliberately synchronous: load/save are sync, and making update() async would change
  // every caller's signature for a lock held only for microseconds.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock() {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_PATH, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      try {
        if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > STALE_MS) {
          fs.unlinkSync(LOCK_PATH); // holder died; reclaim
          continue;
        }
      } catch (statErr) {
        if (statErr.code === "ENOENT") continue; // released between our calls
        throw statErr;
      }

      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the state lock at ${LOCK_PATH}`);
      }
      sleepSync(RETRY_MS);
    }
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function update(fn) {
  acquireLock();
  try {
    const state = load();
    fn(state);
    save(state);
    return state;
  } finally {
    releaseLock();
  }
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
