# Setup & prerequisites

Everything below, once, before you write a line of your own code. No packages beyond what's
listed — the starter kit has zero dependencies on purpose.

## Prerequisites — check these before you start

| Need | Why |
|---|---|
| Node.js 18+ | Runs `starter/lgtm-client.js` — nothing to `npm install`, built-in `fetch` only |
| `git` + GitHub CLI (`gh`) | Creating your repo, later checking/opening PRs, and `/register`/`/update` |
| Claude Code (or any editor) | `CLAUDE.md` auto-loads in Claude Code specifically — see step 4. `/register`/`/update`/`/hackathon-judge` are Claude Code slash commands, need Claude Code to run at all |
| Office network or VPN | An IP in `10.10.0.0/24` or `10.10.1.0/24` — required to reach the shared stack at all |

## Do these in order

1. **Create a public GitHub repo for your prototype**, if you don't already have one:
   ```bash
   gh repo create your-team-name-sreoncall --public --clone
   ```
   (or github.com → New repository → visibility set to **Public**). This is where your code
   lives and where your agent should open PRs for code-level fixes. You'll need this URL in
   step 3.
2. **Get the zip** if you don't already have it — your organizer's shared link/QR — then unzip
   it and open the folder in Claude Code (or your editor).
3. **On your first Claude Code session in this folder**, it will ask for your team id
   (`team-<number>`), the repo URL from step 1, and your team's AI key — answer these before
   anything else. Saved to `.hackathon-team.json` and `.env`. Don't have your AI key yet? Ask
   the organizers — nothing AI-related works without it.
4. **It will then run `/register <team-id> <repo-url>`** for you — puts your team on the live
   leaderboard. This does **not** score you; see step 6 and `05-leaderboard.md`.
5. **Run the connection test**:
   ```bash
   cd starter
   node lgtm-client.js
   ```
   Confirms your network access and the shared telemetry connection both work before you write
   any of your own code. Full details: `starter/README.md`.
6. **Read the rest of this guide** — then `CLAUDE.md` in the zip before you actually start
   writing code. **Run `/update` after every push you want scored** — nothing scores
   automatically, ever. Full mechanics: `05-leaderboard.md`. Watch
   **https://sreoncall-leaderboard.vercel.app**.

**Neither the leaderboard commands nor the judgment skill need setup.** `/register`, `/update`,
and `/hackathon-judge` all ship already configured inside the zip's `.claude/` folder — Claude
Code picks them up automatically the moment you open the folder. Nothing to install or enable.

`/hackathon-judge` is a private self-check, visible only to you — separate from `/update`'s
real, public leaderboard score. Use it as often as you want; it doesn't score anything by
itself.

Steps 3-6 only need doing once. After that, just build (and keep running `/update`) —
`01-architecture.md` explains what you're actually connecting to and why.
