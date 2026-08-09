# AI-Native SREonCall Hackathon — Team Package

## Getting started — do these in order

1. **Create a public GitHub repo for your prototype**, if you don't already have one:
   ```bash
   gh repo create your-team-name-sreoncall --public --clone
   ```
   (or via github.com → New repository → set visibility to **Public**). This is where your
   code lives and where your agent should open PRs for code-level fixes. You'll need this
   URL in step 3.
2. **Unzip this package**, then open the folder in Claude Code (or your editor of choice).
3. **On your first Claude Code session in this folder**, it will ask for your team id
   (`team-<number>`), the repo URL from step 1, and your team's AI key — answer these before
   anything else. Gets saved to `.hackathon-team.json` and `.env`. Don't have your AI key yet?
   Ask the organizers.
4. **It will then run `/register <team-id> <repo-url>`** for you — this puts your team on the
   live leaderboard. Registering does **not** score you; see step 7.
5. **Run the connection test**: `cd starter && node lgtm-client.js` — confirms your network
   access and the shared telemetry connection both work before you write any of your own code.
   Details: `starter/README.md`.
6. **Open `build-guide.html` in a browser** — architecture, connecting to LGTM, judging
   rubric, and command-first testing instructions. Same content also in `docs/` as plain text.
7. **Read `CLAUDE.md`** before writing code — short, and the single most important file in
   this zip: what not to copy from the reference material, and why.

Steps 3-7 only need doing once. After that, just build — **but run `/update` after every push
you want scored.** Nothing scores automatically; see `docs/05-leaderboard.md`. Watch
**https://sreoncall-leaderboard.vercel.app**.

A `/hackathon-judge` self-check skill is also available any time you want an honest, private
read on where your build stands against the rubric — separate from `/update`'s real, public
score. Use it as often as you want; it doesn't count for anything by itself.

## What you're building

A new, standalone prototype of what SREonCall looks like if an AI agent runs it, instead of a
human clicking through it. **Interface is entirely your choice** — a CLI tool, a Slack bot, a
small web UI, a terminal script. Nothing about the interface is judged; what your agent
notices, decides, and does is.

## What's in this zip

| Folder | What it's for |
|---|---|
| `starter/` | **Your actual starting point.** A tested, working connection to the shared observability stack — run it, then build on top of it. |
| `reference/sreoncall/` | **Read-only context, not something you run.** The real SREonCall platform's data models, agent patterns, and API shapes — so you're not guessing or reinventing things that already exist. Do not `npm install`/build/run this. |

There is no local backend or database to stand up. You're not extending a running app — you're
building a new one, informed by the reference material.

## The target app you're monitoring

The OpenTelemetry Demo ("Astronomy Shop") — the real, official multi-service reference app —
runs centrally for everyone, already OTLP-instrumented, already exporting to the shared stack
your `.env` points at:

| What | Where |
|---|---|
| Storefront | http://10.10.1.141:8080 |

**To trigger a fault**, don't use the flagd web UI (:4000) — verified broken in this
deployment, it doesn't persist changes. Use:

```bash
curl -X POST http://10.10.1.141:4001/toggle/<flag>/on
curl http://10.10.1.141:4001/list          # see every flag + current state
curl -X POST http://10.10.1.141:4001/toggle/<flag>/off   # reset when done
```

Full flag list: `docs/04-testing-your-incident-flow.md`. **The specific flag(s) used for
judging are not revealed until code freeze** — practice against all of them, but don't assume
the one you tested is the one that gets judged.

## Troubleshooting

- **`starter/lgtm-client.js` hangs or times out** — you're not on the office network/VPN
  (10.10.0.0/24 or 10.10.1.0/24 required to reach 10.10.1.139/10.10.1.141).
- **It connects but returns empty data** — the shared target app's load generator runs
  continuously, so there should always be recent traffic. If genuinely empty, ping the
  organizers before assuming your own setup is broken.
