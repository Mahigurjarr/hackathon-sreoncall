---
description: Register your team on the SREonCall hackathon leaderboard. Run this once, before you start building.
argument-hint: <team-id> <public-github-repo-url>
allowed-tools: Bash(curl:*), Bash(git remote:*), Bash(git rev-parse:*)
---

# /register

Register this team on the hackathon leaderboard.

- **Scoring API:** `https://mokshayani-ai--sreoncall-leaderboard-web.modal.run`
- **Live board:** `https://sreoncall-leaderboard.vercel.app`

Both are baked into this file — nothing to configure. `LEADERBOARD_URL` only exists as an override
if the organizers move the service.

**Arguments:** `$ARGUMENTS` — expected as `<team-id> <public-github-repo-url>`

## What to do

1. **Parse the two arguments.** If either is missing, stop and show the correct form:
   `/register team-3 https://github.com/your-org/your-repo`. Do not guess a team id.

2. **Sanity-check the repo before sending it.** Each of these is a permanent score of 0 if wrong:
   - It must be an `https://github.com/owner/name` URL. An SSH remote (`git@github.com:...`) is
     rejected — the leaderboard clones anonymously.
   - It must be **public**:
     `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/<owner>/<name>`
     `200` is good; `404` means private or wrong path — say so and stop.
   - It must have a **`main` branch**. Only `main` is graded, and a repo defaulting to `master`
     will never score. Check with `git ls-remote --heads <url> | grep refs/heads/main`.
   - If the URL was omitted and this directory is a git repo, offer the `origin` remote
     (`git remote get-url origin`) in https form and confirm before sending.

3. **Register:**

   ```
   curl -sS -X POST "${LEADERBOARD_URL:-https://mokshayani-ai--sreoncall-leaderboard-web.modal.run}/register" \
     -H 'content-type: application/json' \
     -d '{"team_id":"<team-id>","repo_url":"<repo-url>"}'
   ```

4. **Report the result.** On success, confirm the team id and repo, and tell them the part that
   matters: **registering does not score you — run `/update` whenever you want your latest work on
   the board.** On a 4xx, read the error back; the usual causes are a duplicate team id, a repo the
   server cannot reach, or registration being closed.

## Notes for the team

- Register **once**. Re-running with a different URL updates the repo; re-running with the same one
  is harmless.
- Your repo must stay **public** for the whole event, and only **`main`** is graded. Work on
  branches, but merge to `main` for it to count.
- Watch the board at **https://sreoncall-leaderboard.vercel.app**.
