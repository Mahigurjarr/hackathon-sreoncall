# Testing your incident flow — commands, not reading

Copy, run, check the result. That's the whole doc.

## 1 — Trigger a fault

```bash
# the flagd web UI (4000) does not persist changes in this deployment
# (verified — it fires zero write requests). Use this instead:

curl -X POST http://10.10.1.141:4001/toggle/productCatalogFailure/on

# see every available flag + its current state:
curl http://10.10.1.141:4001/list

# turn it back off when you're done:
curl -X POST http://10.10.1.141:4001/toggle/productCatalogFailure/off
```

Full flag list and what each one breaks. Some fail only n% of the time by design — one request
not showing it isn't proof it's off, send a few:

| Flag | Breaks |
|---|---|
| `productCatalogFailure` | One specific product fails on lookup |
| `paymentFailure` | Payment charge fails, n% of requests |
| `paymentUnreachable` | Payment service fully down |
| `cartFailure` | Cart service fails, n% of requests |
| `failedReadinessProbe` | Cart readiness probe fails |
| `adFailure` | Ad service fails |
| `recommendationCacheFailure` | Recommendation cache fails |
| `adHighCpu` | High CPU load in ad service |
| `adManualGc` | Forced GC pauses in ad service |
| `emailMemoryLeak` | Gradual memory leak in email service |
| `imageSlowLoad` | Slow-loading images in frontend |
| `intlShippingSlowdown` | Delays international shipping responses |
| `kafkaQueueProblems` | Kafka queue overload + consumer lag |

Toggle any of these with the same `/toggle/<flag>/on` command above — swap the flag name.

## 2 — Confirm it's real

```bash
curl -H "X-Scope-OrgID: hackathon" \
  "http://10.10.1.139:3200/api/search?tags=service.name%3D<service>%20error%3Dtrue&limit=5"
```

Fresh error traces back → fault is real. Nothing back → your prototype's bug, not the signal's.

## 3 — Run your pipeline, check each stage

```
[ ] Detection      — noticed unprompted?
[ ] Incident       — real record created?
[ ] RCA            — cites a specific metric/log/trace?
[ ] Resolution     — steps tied to THIS fault?
[ ] Code fix (PR)  — if the fix needs a code change, did it open
                      a real PR on your onboarded repo? (see below)
[ ] Postmortem     — generated unprompted, specific to this run?
```

## 4 — If the fix needs a code change: check the PR

Your onboarded repo URL is already saved in `.hackathon-team.json`. When a resolution is a
code fix, your agent should open a real PR there — check it actually did:

```bash
gh pr list --repo <your-org>/<your-repo>
```

Needs your own GitHub token with push/PR access to your repo — that's on you to wire up, not
provided centrally.

## 5 — Break what a single clean run won't catch

```
# A: re-trigger the SAME fault, diff the two outputs
diff <(echo "$RUN_1_OUTPUT") <(echo "$RUN_2_OUTPUT")
# identical text both times = hardcoding red flag

# B: trigger two DIFFERENT faults back to back, no reset between
# → does it attribute symptoms to the right cause, or conflate them?

# C: ask it directly — "why didn't you check X first?"
# → real reasoning answers from its own trace; canned output can't

# D: flip the flag back to "off" mid-incident
# → does it notice recovery, or stay stuck reporting a fixed problem?
```

## Pass bar

Every sentence in your postmortem should trace to a real trace ID, log line, or metric value
you can point at. Can't point at it → that's the gap, not a new feature to build instead.
