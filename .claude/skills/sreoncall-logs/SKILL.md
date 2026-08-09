---
name: sreoncall-logs
description: The standard readable format for everything this agent prints — daemon sweep logs, investigation progress, recall verdicts, remediation decisions, and errors — plus how to render fetched telemetry (Loki log lines, Mimir series, Tempo spans) so a human can actually read them. Use this skill whenever writing or changing a console.log/console.error/console.warn anywhere in src/ or bin/, whenever formatting fetched logs or query results for display or for the model, and whenever someone says the logs are noisy, unreadable, or hard to follow. Read it before writing the log line, not after.
---

# Log format

Two different readers, two different formats. Confusing them is why logs become unreadable.

1. **Operator logs** — what the daemon prints to stdout. Read by a human watching
   `docker compose logs -f` at 3am, scanning for what changed.
2. **Fetched telemetry** — Loki lines, Mimir series, Tempo spans pulled from the stack. Read
   by the model during an investigation, and by a human in the evidence drawer.

## 1. Operator logs

### The line format

```
[<lane>] <subject> <verb-phrase>[ — <detail>]
```

- `<lane>` — which part of the agent is speaking: `sentinel`, `investigator`, `recall`,
  `remediation`, `web`. One word, always bracketed, always lowercase. It is the thing that
  makes `grep '\[recall\]'` useful.
- `<subject>` — the id or name the line is about: `INC-4`, `checkout`, `P2`. Put it early;
  a reader scans the left edge.
- `<verb-phrase>` — what happened, past tense, plain words.
- `<detail>` — optional, after an em dash. The reason, the number, the error.

```
[sentinel] sweep complete — 4 anomalies, 2 emerging risks, 1 incident opened
[recall] checkout — related to INC-9, investigating fully with it as orientation
[remediation] INC-4 — drafted P2, 3 files, awaiting approval
[sentinel] INC-5 — no repo change proposed, root cause is a feature flag
```

### Rules

- **One line per event.** Never wrap, never multi-line except a stack trace on a genuine crash.
- **Lead with the lane and subject**, so a reader can scan the left edge without reading fully.
- **Say what changed, not what is being attempted.** `investigating checkout` tells a reader
  nothing they can use; `opened INC-4 for checkout` does. If a step is slow enough to need a
  "starting" line, that line must name the expected duration.
- **Numbers get units.** `2.4s`, `4 anomalies`, `3 files`. A bare number is a guess.
- **Never log a secret.** No token, no API key, no `Authorization` header, ever — not even
  truncated. `.env` is gitignored precisely so these never leave the machine; printing one
  into stdout undoes that.
- **Never log a full query response.** The ledger already holds it, with an id. Log the id.
- **Errors say what failed AND what happens next.** `investigation failed for cart — timeout;
  retrying next sweep` beats `Error: timeout`. A reader's first question is always "so is it
  broken or not?"
- **No emoji, no ASCII art, no box-drawing.** They break `grep`, they break log shipping, and
  they read as noise in a terminal.
- **Silence is a bug.** Any decision the agent makes on its own — recall verdict, decline to
  propose, reuse of a prior fix — must produce exactly one line. An agent that acts silently
  cannot be trusted, and cannot be debugged.

### Levels

`console.log` for events. `console.error` for something that failed. `console.warn` only for
"this succeeded but you should know" (e.g. a model cited an evidence id that didn't resolve).
Nothing else — no debug level shipping to stdout in a running container.

## 2. Fetched telemetry

Raw Loki/Mimir/Tempo JSON is unreadable by a human and wasteful in a model's context window.
Everything fetched gets **summarised for reading, with the untouched original kept**.

- The `summary` is one line: what the query returned, in words with numbers.
  `18 series, 1 with errors above zero (checkout, 0.24/s)`.
- The **raw response is never discarded** — it goes into the ledger entry under `raw`, so the
  evidence drawer can show exactly what came back. Summarising is for reading, never for
  storing less.
- **Never send the full raw payload back to the model** turn after turn. It balloons cost with
  no reasoning benefit — the summary plus extracted fields already say what it means. Bound
  arrays; say what was omitted and how to get it.
- Log lines rendered for a human keep this shape:

  ```
  <HH:MM:SS> <level> <service> <message>
  ```

  Timestamps localised, level padded to 5 chars, service in mono. Never dump the label set
  inline — it is the same on every line and drowns the message.
- **Say when a result is empty, and say which kind of empty.** "no series returned" and "a
  value of zero" are different facts about the world; collapsing them into "no data" destroys
  the distinction the whole investigation may hinge on.

## Checklist

- [ ] `[lane] subject verb — detail`, one line
- [ ] Lane is one of: sentinel, investigator, recall, remediation, web
- [ ] Past tense, plain words, no jargon a non-SRE couldn't follow
- [ ] Numbers carry units
- [ ] No secrets, no full payloads, no emoji
- [ ] Errors name the consequence ("retrying next sweep")
- [ ] Every autonomous decision produces exactly one line
