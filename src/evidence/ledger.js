// The evidence ledger — the mechanism behind auditability.
//
// Every query the agent runs is recorded here and gets an id (E1, E2, ...). Claims must
// cite those ids. Because citations are assigned at query time rather than attached to
// prose afterwards, a claim can only cite evidence that was actually gathered.

const store = require("../store/state");
const { chat, MODELS } = require("../llm/client");

// The next id, taken from the highest number already issued — NOT from the array's length.
//
// Length was the original scheme, and it collides: the live ledger had two entirely different
// PromQL queries both recorded as E88, because two entries were appended within one sweep from
// different code paths. A duplicate id is not a cosmetic problem. Every claim this agent makes
// is only checkable because [E#] resolves to the exact query behind it, and a citation that
// resolves to whichever of two rows is found first is a claim that quietly cannot be verified.
//
// Ids are never reused even if an entry is somehow dropped, which is the correct trade: a gap
// in the numbering is harmless, a reused number is not.
function nextId(evidence) {
  let highest = 0;
  for (const entry of evidence || []) {
    const n = Number(String(entry?.id || "").slice(1));
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `E${highest + 1}`;
}

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
      entry.id = nextId(this.state.evidence);
      this.state.evidence.push(entry);
      return entry;
    }

    let created;
    store.update((s) => {
      entry.id = nextId(s.evidence);
      s.evidence.push(entry);
      created = entry;
    });
    return created;
  }

  // Entries as the store hands them over: ids, queries, summaries, and a raw body only for
  // the readings the dashboard charts. Everything here needs the metadata, not the bodies —
  // validate() reads ids, repair() reads summaries.
  all() {
    return (this.state || store.load()).evidence;
  }

  // The full record, body included — this is what a citation resolves to, so it must never be
  // the trimmed copy. Goes straight to the store by id rather than scanning the array, which
  // is also the difference between one indexed lookup and hydrating the whole ledger.
  get(id) {
    if (this.state) return this.state.evidence.find((e) => e.id === id) || null;
    return store.getEvidence(id);
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

  // An invented citation must not just be logged and shipped — that was the gap: three
  // separate call sites (the RCA, a remediation's PR body/decline reason, a redemption
  // verdict) used to warn and pass the text through unchanged. This gives the model exactly
  // one chance to fix its own mistake before that happens: shown precisely which ids don't
  // resolve and a list of every id that DOES exist in this run, it either replaces the bad
  // citation with a real one or removes the specific unbacked claim. Never invents a new id —
  // the prompt forbids it, and re-validating the result (not trusting the model's word) is
  // what makes this "repair", not "ask nicely".
  //
  // Bounded to exactly one attempt. If it still doesn't resolve, the caller's existing
  // warn-and-flag path is the correct fallback — a repair loop that retries indefinitely would
  // burn budget chasing a citation the model may not be able to fix, and every genuine failure
  // still needs to surface, never disappear into a longer retry chain.
  async repair(text, { model = MODELS.fast } = {}) {
    const { unresolved } = this.validate(text);
    if (!unresolved.length) return { text, repaired: false, stillUnresolved: [] };

    const validIds = this.all().map((e) => `${e.id}: ${e.summary}`);

    const prompt = [
      `The following text cites evidence ids that do not exist in this run: ${unresolved.join(", ")}.`,
      "An invented citation is worse than an unbacked claim — it looks verified when it isn't.",
      "",
      "Text:",
      String(text),
      "",
      "Evidence ids that actually exist (id: summary):",
      validIds.length ? validIds.join("\n") : "(none)",
      "",
      `Rewrite the text. For each of ${unresolved.join(", ")}: if the claim is genuinely `
        + "supported by one of the real ids above, cite that id instead. If it isn't, remove "
        + "that specific unbacked clause and its citation entirely — do not soften it into an "
        + "uncited claim, remove it. Never invent a new id. Return ONLY the corrected text.",
    ].join("\n");

    let repairedText = text;
    try {
      const reply = await chat({ model, messages: [{ role: "user", content: prompt }] });
      repairedText = (reply.text || "").trim() || text;
    } catch {
      // A failed repair call is not a reason to lose the original text — fall through to
      // returning it unchanged, which the caller's existing warn-and-flag path handles.
    }

    const revalidated = this.validate(repairedText);
    return { text: repairedText, repaired: repairedText !== text, stillUnresolved: revalidated.unresolved };
  }
}

module.exports = { Ledger, nextId };
