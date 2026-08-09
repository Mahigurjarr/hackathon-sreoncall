// The evidence ledger — the mechanism behind auditability.
//
// Every query the agent runs is recorded here and gets an id (E1, E2, ...). Claims must
// cite those ids. Because citations are assigned at query time rather than attached to
// prose afterwards, a claim can only cite evidence that was actually gathered.

const store = require("../store/state");

class Ledger {
  constructor(state = null) {
    // When handed a live state object, mutate it in place (caller persists).
    // Otherwise go through the store on every write.
    this.state = state;
  }

  record({ kind, query, target = null, raw, summary = null }) {
    const entry = {
      kind,          // 'metric' | 'log' | 'trace'
      query,         // the literal PromQL / LogQL / TraceQL sent
      target,        // service this was about, if any
      summary,       // short human-readable reading of the result
      at: new Date().toISOString(),
      raw,           // the untouched response, so a judge can check our reading of it
    };

    if (this.state) {
      entry.id = `E${this.state.evidence.length + 1}`;
      this.state.evidence.push(entry);
      return entry;
    }

    let created;
    store.update((s) => {
      entry.id = `E${s.evidence.length + 1}`;
      s.evidence.push(entry);
      created = entry;
    });
    return created;
  }

  all() {
    return (this.state || store.load()).evidence;
  }

  get(id) {
    return this.all().find((e) => e.id === id) || null;
  }

  // Pull [E7] style citations out of model prose.
  cited(text) {
    if (!text) return [];
    return [...new Set([...String(text).matchAll(/\[(E\d+)\]/g)].map((m) => m[1]))];
  }

  // Every citation must resolve to a real recorded query. An unresolved citation means the
  // model invented evidence — that must surface as a failure, never reach the operator.
  validate(text) {
    const ids = this.cited(text);
    const known = new Set(this.all().map((e) => e.id));
    const unresolved = ids.filter((id) => !known.has(id));
    return { ok: unresolved.length === 0, cited: ids, unresolved };
  }
}

module.exports = { Ledger };
