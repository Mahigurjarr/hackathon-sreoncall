# Ask-bar accuracy eval (promptfoo)

The accuracy flywheel for the AI Ask bar (NL → LogQL/PromQL). Golden cases assert the generated
query is **valid** and uses the **right parser** — catching the failure modes from review
(nested-quote escaping; `| json` hallucinated on non-JSON `key=value` text).

## Run it (manual / nightly — NOT per-PR CI)

Real model calls cost money and need a key, so this is **not** wired into CI.

```bash
cd packages/api/eval
export OPENAI_API_KEY=sk-...          # key via env ONLY — never commit it
npx promptfoo@latest eval             # runs ask-bar-golden.yaml against the prompt
npx promptfoo@latest view             # open the results UI
```

Pairs with the runtime **telemetry** (`ask-bar.generate` / `ask-bar.feedback` structured logs): telemetry
tells you *what's failing in prod* (empty results, repairs, user edits); the golden set lets you *reproduce
and fix* it, then locks the fix in.

## Files

- `ask-bar-golden.yaml` — the test cases (question + assertions).
- `assert-valid-logql.js` — custom assertion; parses output with the **same `@grafana/lezer-logql`
  grammar** the API's `query-validation.service.ts` uses, so eval and runtime agree on "valid".
- `promptfooconfig.yaml` — provider + prompt. **Keep the prompt here in sync** with
  `src/services/ai-observability-prompt.ts` (`OBSERVABILITY_GENERATE_LOGQL_PROMPT`) when you change it.

## Add a case

Append to `ask-bar-golden.yaml`:
```yaml
  - description: "what this checks"
    vars: { question: "the NL question a user would type", lang: logql }
    assert:
      - type: javascript
        value: file://assert-valid-logql.js     # must be valid LogQL
      - type: contains
        value: 'expected substring'
      - type: not-contains
        value: 'anti-pattern (e.g. | json on non-JSON)'
```
Seed new cases from real `ask-bar.*` telemetry: when prod shows a question that produced an empty/edited/
repaired query, distill it into a golden case here.
