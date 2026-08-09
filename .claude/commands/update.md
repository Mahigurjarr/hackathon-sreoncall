---
description: Score your team's latest work on the hackathon leaderboard. Run this after every push you want counted.
allowed-tools: Bash(curl:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git log:*)
---

# /update

Score this team's latest work.

- **Scoring API:** `https://mokshayani-ai--sreoncall-leaderboard-web.modal.run`
- **Live board:** `https://sreoncall-leaderboard.vercel.app`

Both are baked into this file — nothing to configure.

## What to do

1. **Check there is something new to score.** The server grades whatever is on `main` **at GitHub**,
   not your working tree:
   - `git status --short` — warn about uncommitted changes; they will not be scored.
   - `git rev-parse HEAD` vs `git rev-parse origin/main` — if they differ, the newest work has not
     been pushed. Say so and offer to stop, because the re-score would grade the old commit.

2. **Request the score:**

   ```
   curl -sS -X POST "${LEADERBOARD_URL:-https://mokshayani-ai--sreoncall-leaderboard-web.modal.run}/update" \
     -H 'content-type: application/json' \
     -d '{"team_id":"<your-team-id>"}'
   ```

   Take the team id from `$LEADERBOARD_TEAM_ID` if set; otherwise ask.

3. **Report what came back.** A queued response means the run is enqueued — about three minutes,
   then it appears at **https://sreoncall-leaderboard.vercel.app**. Nothing to poll; watch the board.

## Notes for the team

- **This is how you get scored.** There is no automatic scoring. Your score changes only when you run
  `/update` (or an organizer triggers a re-score). Push, then `/update`.
- Rate-limited to **once per minute** per team. Spamming it gets refused, not scored faster.
- If the commit hasn't changed since your last run, the grade is skipped and your existing score
  stands — deliberate, since re-grading identical code only adds noise.
- The grader **reads** your repo and never runs it, so a re-score cannot break anything on your side.
- Scored on the diff against the starting codebase — your own work, not the platform you were handed.
