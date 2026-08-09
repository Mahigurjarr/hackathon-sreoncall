# The live leaderboard — `/register` and `/update`

Two commands, both already set up in `.claude/commands/` — nothing to install.

**Your team id and repo URL are asked for exactly once**, during onboarding (see
`00-getting-started.md` step 3) — saved to `.hackathon-team.json` and `.env`. `/register` and
`/update` both reuse those saved values automatically. If anything ever asks you for either a
second time, that's a bug — say so.

## `/register` — once, at the start

```
/register team-3 https://github.com/your-org/your-repo
```

Puts your team on the board. Does its own checks before sending anything — the repo must be
`https://` (not an SSH remote), **public**, and have a **`main`** branch (only `main` is ever
graded). Fix whatever it flags before moving on.

**Registering does not score you.** It just puts your team on the board at zero. See below for
what actually moves your score.

## `/update` — every time you want your score to move

```
/update
```

Run this after every push you want counted. Nothing is scored automatically — no `/update`,
no score change, no matter how much you've pushed.

- Grades whatever is on `main` **at GitHub**, not your local working tree. Uncommitted or
  unpushed changes are invisible to it — push first.
- Async: you'll get a "queued" response, the actual grade lands on the board in **~3 minutes**.
  Nothing to poll — just check **https://sreoncall-leaderboard.vercel.app**.
- Rate-limited to **once per minute** per team. Spamming it doesn't score faster.
- If the commit hasn't changed since your last `/update`, it's skipped — your existing score
  stands. Re-grading identical code would just add noise.
- **Read-only against your repo** — it never runs your code, so this can't break anything on
  your side.
- Scored on the diff against the starting codebase (what you were handed) — your own work,
  not the platform.

## The board

**https://sreoncall-leaderboard.vercel.app** — watch it after every `/update`, not before.

## This is separate from `/hackathon-judge`

`/hackathon-judge` (also already set up, see `CLAUDE.md`) is a private self-check — it reads
your own code and gives you an honest opinion, visible only to you. `/update` is the real,
public score. Use `/hackathon-judge` as often as you want while building; `/update` is the one
that actually counts.
