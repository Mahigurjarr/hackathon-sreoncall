---
name: sreoncall-auditability
description: The evidence-ledger citation contract and the citation-REPAIR mechanism — every [E#] a model cites must resolve to a real recorded query, and an invented one now gets one real repair attempt (Ledger.repair) before it ships, not just a console.warn while it passes through unchanged. Use this skill whenever touching src/evidence/ledger.js, whenever adding a new place a model's text gets stored (an RCA, a PR body, a decline reason, a verdict), and whenever someone asks to improve auditability, evidence integrity, or citation checking. Read it before adding a fourth call site that validates citations without repairing them — that regresses exactly the gap this skill exists to close.
---

# Auditability

Auditability's whole claim is: **every factual statement the agent makes can be traced to a
real query it actually ran.** The mechanism is `src/evidence/ledger.js` — every tool call
records `{kind, query, target, summary, raw, at}` and gets a stable `E<n>` id; a claim cites
that id; nothing lets a claim cite an id that was never assigned.

## The gap this skill exists to close

Checking citations and **warning** when one doesn't resolve is not the same as auditability —
it just means the system knows it's lying and ships the sentence anyway. Every text a model
produces that carries citations now gets **one real repair attempt** before it's stored:

```js
const result = await ledger.repair(text);
// result.text            — the (possibly rewritten) text to actually store
// result.repaired        — whether the model changed anything
// result.stillUnresolved — non-empty only if repair itself failed to fix it
```

`Ledger.repair()` (in `ledger.js`, next to `validate()`) shows the model exactly which ids
don't resolve and every id that *does* exist in this run (id + summary), and asks it to either
cite a real one or **remove** the specific unbacked clause — never invent a replacement id, and
never soften an unbacked claim into vaguer prose that keeps the claim without the citation.
The result is re-validated in code, not trusted on the model's word — repair is a real second
check, not a politer first one.

**Three call sites, each wired identically** — if you add a fourth place a model's text gets
stored with citations, wire it the same way:

| Call site | What gets repaired |
|---|---|
| `investigator/loop.js` → `investigate()` | The final RCA text |
| `actions/remediation.js` → `draftRemediation()` / `reviseRemediation()` | The `no_code_fix` reason, and the PR body |
| `actions/redemption.js` → `verifyRecovery()` | The recovery verdict's `reason` — the text that can close an incident |

## Why bounded to exactly one attempt

An unbounded repair loop would burn budget chasing a citation the model may genuinely be
unable to fix, and — worse — could hide a real failure behind an ever-longer retry chain
instead of surfacing it. One attempt is enough to catch the common case (the model misnumbered
an id, or cited one from a different investigation); if that attempt doesn't resolve it, the
existing fallback — flag it, never silently drop it — is still correct and still runs.

**Never remove the fallback path.** Repair raises the odds of a clean result; it does not
replace the requirement that an unresolved citation must still surface if repair fails.

## Why this is not the same as "hard-fail the whole write"

The gap could also be closed by rejecting the entire RCA/PR/verdict outright when one citation
fails to resolve. That's strictly worse: it throws away a genuine, mostly-correct analysis over
one bad clause, and a redemption verdict that fails to save at all is worse for auditability
than one saved with a flagged citation — the failure becomes invisible instead of visible.
Repair-then-flag is strictly better science than either "warn and ship" or "reject outright":
it fixes what can be fixed, and is honest about what can't.

## `store.update()` is synchronous — repair calls must resolve before it, not inside it

`Ledger.repair()` makes a real (async) model call. `store.update(fn)` runs `fn` synchronously
(`src/store/state.js`) — you cannot `await` inside an `update()` callback. Every call site
above resolves its repair call **before** entering the `update()`/`draftProposal()` call that
persists the result; do the same for any new one. `reviseRemediation()` is the clearest
example of the pattern: repair happens first, the plain (already-resolved) string goes into
the synchronous store callback.

## The rest of the ledger contract, unchanged

- `record()` assigns the next `E<n>` id at query time — a citation can only ever reference
  evidence that was actually gathered, because ids don't exist before the query ran.
- `raw` is always the untouched response, kept for a human to audit the model's own reading of
  it — never replaced or summarized away, even after `repair()` rewrites the citing text.
- `cited(text)` / `validate(text)` stay pure string operations with no network call — `repair`
  is the only method on `Ledger` that talks to the model, and it is opt-in per call site, not
  automatic inside `validate()`. Keep that separation: a caller that only wants to *check*
  should never accidentally trigger a network call.

## Before you touch this subsystem

- [ ] Every new place a model's cited text gets stored calls `ledger.repair()` before storing it
- [ ] Repair is still bounded to one attempt — no retry loop
- [ ] A citation that survives repair unresolved still surfaces (console.warn at minimum;
      the existing `unresolvedCitations`/`stillUnresolved` fields still get threaded through)
- [ ] No repair call happens inside a synchronous `store.update()` callback
- [ ] `repair()` never invents a new evidence id — only cites existing ones or removes the claim
- [ ] `raw` responses in the ledger are still never altered by a repair pass

## Related

- [[sreoncall-ai-native-gate]] — the broader principle this skill is one instance of: a
  correction should come from the model reasoning again over real evidence, never from
  deterministic code quietly patching over what it produced
- [[sreoncall-ownership]] — the PR body and decline reason this skill repairs
- [[sreoncall-memory]] — the redemption verdict this skill repairs, which can close an incident
