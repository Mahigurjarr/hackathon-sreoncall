// The agent's memory, on SQLite (`node:sqlite`, built into Node — still zero npm
// dependencies, see CONTRACTS.md).
//
// It used to be one JSON file. That was the right call at the start: a judge could open
// store/state.json and read the agent's entire memory in plain text. It stopped being the
// right call once the evidence ledger passed a thousand records — every single write, and
// there is one per query the agent runs, re-parsed and re-serialised the whole 15MB file
// under a lock held by two processes. Cost per write grew with everything ever recorded.
//
// The API here is deliberately UNCHANGED — load(), save(), update(), newIncident(). Every
// caller still gets one plain state object and mutates it in place, because that shape is
// what makes the rest of the codebase readable. What changed is what happens underneath:
//
//   - Appending a record is an INSERT, not a rewrite of everything ever recorded.
//   - Raw response bodies (95% of the bulk) stay in the database until something asks for a
//     specific one. load() hydrates only the recent metric readings the dashboard charts.
//   - Reads and writes run inside a real transaction, so a crash mid-update rolls back
//     instead of leaving a half-written state.
//
// The plain-text property is not lost: `npm run state:export` writes the whole thing back out
// as JSON, and /api/state still serves it.
//
// Cross-process locking: the lockfile is KEPT, wrapping each transaction. SQLite has its own
// locking, but store/ is a Docker bind mount shared by two containers, and file-lock semantics
// across that boundary are exactly the thing not to bet correctness on. The lockfile is proven
// on this mount (O_EXCL is atomic there); SQLite provides atomicity and durability. Belt and
// braces, on purpose — losing a human's approval to a lost update is the failure being
// prevented, and it is not a cheap one.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

// Tests point this at a throwaway path. A .json path is accepted so existing callers and the
// pre-migration file keep working; the database lives beside it.
const STATE_PATH = process.env.SRE_STATE_PATH
  || path.join(__dirname, "..", "..", "store", "state.json");
const DB_PATH = STATE_PATH.replace(/\.json$/, "") + ".db";

// Collections with a stable `id`: rows are matched, updated, and deleted by it.
const KEYED = { incidents: "incidents", proposals: "proposals", copilotConversations: "copilot_conversations" };
// Collections that are plain ordered arrays with no id. Small or explicitly bounded; rewritten
// wholesale when they change.
const ORDERED = { emergingRisks: "emerging_risks", detections: "detections", installs: "installs", traces: "traces" };
// `evidence` is neither: it is append-only and carries the raw bodies. See persistEvidence.

const EMPTY = { incidents: [], evidence: [], installs: [], traces: [], lastSweep: null, emergingRisks: [] };

// How many of the most recent metric readings keep their raw response in a load(). The
// dashboard's trend charts read `raw.data.result[].value[1]` for these; nothing else needs a
// body until someone opens a specific record.
const HYDRATE_METRIC_RAW = Number(process.env.SRE_HYDRATE_METRIC_RAW) || 400;

let db = null;

function connect() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = TRUNCATE;
    PRAGMA synchronous = FULL;
    -- The API and the sentinel are separate processes on a shared bind mount. The lockfile
    -- below serialises WRITERS, but a reader still holds a shared lock while it runs, and a
    -- writer that finds one fails instantly with SQLITE_BUSY unless told to wait. Without
    -- this, a dashboard poll landing at the wrong moment kills a whole sweep with "database
    -- is locked". Rollback journal rather than WAL on purpose: WAL needs shared memory, and
    -- betting cross-container correctness on mmap over a bind mount is not a trade worth
    -- making for a store this size.
    PRAGMA busy_timeout = 10000;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS copilot_conversations (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS emerging_risks (ord INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS detections (ord INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS installs (ord INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS traces (ord INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY, ord INTEGER NOT NULL, kind TEXT, meta TEXT NOT NULL, raw TEXT
    );
    CREATE INDEX IF NOT EXISTS evidence_kind_ord ON evidence (kind, ord);
  `);
  migrateFromJson();
  return db;
}

// One-time import of the pre-SQLite file. Runs only when the database is empty, so it can
// never clobber live data, and never deletes state.json — that file stays as the last JSON
// snapshot of everything the agent knew before the move.
function isEmpty() {
  return db.prepare("SELECT COUNT(*) AS n FROM evidence").get().n
    + db.prepare("SELECT COUNT(*) AS n FROM incidents").get().n
    + db.prepare("SELECT COUNT(*) AS n FROM kv").get().n === 0;
}

function migrateFromJson() {
  if (!isEmpty()) return;

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return; // no prior file (or unreadable) — a fresh agent, nothing to import
  }

  // Both containers open the store at boot, so two processes can reach this at once. The
  // same lockfile that serialises writes serialises the import, and the emptiness check runs
  // again inside it — otherwise the loser of the race imports a second time on top of the
  // winner's rows.
  acquireLock();
  try {
    if (!isEmpty()) return;
    db.exec("BEGIN IMMEDIATE");
    try {
      writeAll({ ...EMPTY, ...legacy });
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    const counts = `${(legacy.incidents || []).length} incidents, ${(legacy.evidence || []).length} evidence`;
    console.log(`[store] migrated ${counts} from ${path.basename(STATE_PATH)} into ${path.basename(DB_PATH)}`);
  } finally {
    releaseLock();
  }
}

// --- reading -----------------------------------------------------------------------------

function rowsOf(table) {
  return connect().prepare(`SELECT json FROM ${table} ORDER BY ord`).all().map((r) => JSON.parse(r.json));
}

/**
 * The whole state as one plain object, exactly as callers have always received it.
 *
 * The single difference: an evidence entry outside the hydrated window arrives without its
 * `raw` body and carries `rawAvailable: true` instead. It is withheld, never lost — getEvidence()
 * returns the complete record, and that is what /api/evidence/:id and every [E#] chip resolve
 * through. Nothing that reads state.evidence needs a body: they read ids, queries, and summaries.
 */
function load() {
  connect();
  const state = { ...EMPTY };

  for (const row of db.prepare("SELECT key, json FROM kv").all()) state[row.key] = JSON.parse(row.json);
  // Every collection is always present, empty or not. The file store only had a field once
  // something had written it, so callers grew `(state.proposals || [])` guards for a state
  // that was merely young — an empty collection and a missing one are not different things
  // here, and pretending otherwise is how an absent-vs-zero bug gets written.
  for (const [field, table] of Object.entries(KEYED)) state[field] = rowsOf(table);
  for (const [field, table] of Object.entries(ORDERED)) state[field] = rowsOf(table);

  // Two queries, deliberately. The bodies are the bulk of this database, and the whole point
  // of the move was to stop paying for all of them on every read — so the scan that walks
  // every entry never selects `raw` at all, and a second, bounded query fetches only the
  // recent metric bodies the dashboard's charts actually plot. Selecting raw in the scan and
  // discarding it afterwards costs the same as the file store did.
  const hydrated = new Map(
    db.prepare("SELECT id, raw FROM evidence WHERE kind = 'metric' AND raw IS NOT NULL ORDER BY ord DESC LIMIT ?")
      .all(HYDRATE_METRIC_RAW).map((r) => [r.id, r.raw])
  );
  state.evidence = db.prepare("SELECT id, meta, raw IS NOT NULL AS hasRaw FROM evidence ORDER BY ord")
    .all()
    .map((row) => {
      const entry = JSON.parse(row.meta);
      if (!row.hasRaw) return entry;
      if (hydrated.has(row.id)) entry.raw = JSON.parse(hydrated.get(row.id));
      else entry.rawAvailable = true;
      return entry;
    });

  return state;
}

/** One evidence record, body included. The resolution behind every citation. */
function getEvidence(id) {
  connect();
  const row = db.prepare("SELECT meta, raw FROM evidence WHERE id = ?").get(id);
  if (!row) return null;
  const entry = JSON.parse(row.meta);
  if (row.raw !== null) entry.raw = JSON.parse(row.raw);
  return entry;
}

// --- writing -----------------------------------------------------------------------------

function splitEvidence(entry) {
  const { raw, rawAvailable, ...meta } = entry;
  return { meta: JSON.stringify(meta), raw: raw === undefined || raw === null ? null : JSON.stringify(raw) };
}

/**
 * Evidence is APPEND-ONLY, and this function enforces that by only ever inserting ids it has
 * not seen. It deliberately does not update existing rows.
 *
 * That is a safety property, not an optimisation: load() hands out most entries without their
 * body, so writing one of those back would replace a real recorded response with nothing. An
 * agent quietly losing the evidence behind its own citations is precisely the failure this
 * codebase exists to make impossible — a citation that no longer resolves is worse than one
 * never made. Nothing in the codebase mutates a recorded entry (Ledger.record only appends),
 * and test/store-substrate.test.js holds that line.
 */
function persistEvidence(evidence) {
  const known = new Set(db.prepare("SELECT id FROM evidence").all().map((r) => r.id));
  const insert = db.prepare("INSERT INTO evidence (id, ord, kind, meta, raw) VALUES (?, ?, ?, ?, ?)");
  let ord = db.prepare("SELECT COALESCE(MAX(ord), 0) AS n FROM evidence").get().n;
  for (const entry of evidence) {
    if (!entry?.id || known.has(entry.id)) continue;
    const { meta, raw } = splitEvidence(entry);
    insert.run(entry.id, ++ord, entry.kind || null, meta, raw);
    known.add(entry.id);
  }
}

function persistKeyed(table, items) {
  const existing = new Map(db.prepare(`SELECT id, json FROM ${table}`).all().map((r) => [r.id, r.json]));
  const upsert = db.prepare(`INSERT INTO ${table} (id, ord, json) VALUES (?, ?, ?)
                             ON CONFLICT(id) DO UPDATE SET ord = excluded.ord, json = excluded.json`);
  const seen = new Set();
  items.forEach((item, index) => {
    if (!item?.id) return;
    seen.add(item.id);
    const json = JSON.stringify(item);
    if (existing.get(item.id) !== json || existing.has(item.id) === false) upsert.run(item.id, index, json);
  });
  const remove = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  for (const id of existing.keys()) if (!seen.has(id)) remove.run(id);
}

// Small, ordered, and id-less: cheaper to rewrite than to diff, and only when the content
// actually changed (a sweep that adds no risks must not churn 500 rows).
function persistOrdered(table, items) {
  const current = db.prepare(`SELECT json FROM ${table} ORDER BY ord`).all().map((r) => r.json);
  const next = items.map((item) => JSON.stringify(item));
  if (current.length === next.length && current.every((json, i) => json === next[i])) return;
  db.prepare(`DELETE FROM ${table}`).run();
  const insert = db.prepare(`INSERT INTO ${table} (json) VALUES (?)`);
  for (const json of next) insert.run(json);
}

function writeAll(state) {
  const arrays = new Set([...Object.keys(KEYED), ...Object.keys(ORDERED), "evidence"]);
  const setKv = db.prepare("INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json");
  const dropKv = db.prepare("DELETE FROM kv WHERE key = ?");

  for (const [key, value] of Object.entries(state)) {
    if (arrays.has(key)) continue;
    if (value === undefined) dropKv.run(key);
    else setKv.run(key, JSON.stringify(value));
  }
  for (const [field, table] of Object.entries(KEYED)) persistKeyed(table, state[field] || []);
  for (const [field, table] of Object.entries(ORDERED)) persistOrdered(table, state[field] || []);
  persistEvidence(state.evidence || []);
}

/** Replaces the entire state. Used by tests and by the JSON import; not on any hot path. */
function save(state) {
  connect();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of ["kv", ...Object.values(KEYED), ...Object.values(ORDERED), "evidence"]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    writeAll({ ...EMPTY, ...state });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// --- cross-process mutex -------------------------------------------------------------------
//
// The sentinel and the web API are separate processes in separate containers, sharing store/
// through a bind mount. Both call update(): the daemon writes sweep results, the API writes
// proposal approvals. Without a mutex, load() → mutate → write from two processes interleaves
// and one silently discards the other's changes — losing, say, an approved PR because a sweep
// finished a millisecond later.
//
// O_EXCL create is atomic on both local filesystems and Docker bind mounts, which is all this
// needs. A lock older than STALE_MS is broken on the assumption its holder crashed — without
// that, one hard kill would wedge every writer forever.
const LOCK_PATH = `${DB_PATH}.lock`;
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

/**
 * Read-modify-write, serialised across processes and atomic within one. The callback mutates a
 * plain state object; nothing is visible to another reader until it returns. If it throws, the
 * transaction rolls back and the store is exactly as it was — a half-applied sweep is not a
 * state this system is ever allowed to be in.
 */
function update(fn) {
  connect();
  acquireLock();
  try {
    const state = load();
    fn(state);
    db.exec("BEGIN IMMEDIATE");
    try {
      writeAll(state);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
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

/** Everything, bodies included, as one JSON object — the plain-text read the file gave for free. */
function exportAll() {
  const state = load();
  state.evidence = state.evidence.map((entry) => getEvidence(entry.id) || entry);
  return state;
}

module.exports = { load, save, update, newIncident, getEvidence, exportAll, STATE_PATH, DB_PATH };
