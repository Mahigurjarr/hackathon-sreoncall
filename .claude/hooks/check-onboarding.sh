#!/bin/bash
# SessionStart hook — reminds Claude to complete team onboarding until it's done.
# Runs every session start, not just the first, so it survives a restarted
# session before onboarding finishes.

MARKER=".hackathon-team.json"

if [ ! -f "$MARKER" ]; then
  cat <<'EOF'
[hackathon-onboarding] No .hackathon-team.json found yet. Before doing anything
else this session, ask the user for their team id (format: team-<number>) and
the URL of the public git repo they'll push their prototype to. If they don't
have a repo yet, tell them to create a new PUBLIC GitHub repo now (gh repo
create <name> --public --clone, or via github.com) before answering. Write
both answers to .hackathon-team.json as {"team": "...", "repo": "..."}, AND
add LEADERBOARD_TEAM_ID=<team-id> to .env. This is the only time the team id
or repo URL gets asked for. Then run /register <team-id> <repo-url> with
those same values to put the team on the live leaderboard — do not skip this,
registering does not happen any other way. Also confirm OPENAI_API_KEY is set
in .env — if blank, ask for the key their team was issued and have them paste
it, then save it into .env. Do not proceed to any other work until all of
this is done.
EOF
else
  TEAM_ID=$(grep -o '"team"[[:space:]]*:[[:space:]]*"[^"]*"' "$MARKER" | sed -E 's/.*"([^"]+)"$/\1/')
  echo "[hackathon-onboarding] Team already registered ($(cat "$MARKER"))."
  echo "[hackathon-onboarding] Reminder: when running /update, use team id '$TEAM_ID' directly — never ask the user for it again, it was already answered once."
fi
