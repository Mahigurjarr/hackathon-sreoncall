> **Hackathon note**: this folder is reference material only — see `CLAUDE.md` and `README.md`
> two levels up. Don't run the setup steps below; they're accurate for this codebase in
> general, just not for what you're building today.

# SREonCall

A multi-tenant SRE platform — incidents, on-call scheduling, alerting, change
management, tickets, runbooks, status pages, observability, and AI-assisted
incident response — built for teams who run production and the MSPs who run
it for them.

## Monorepo layout

```
packages/api    Express 5 + TypeScript backend (MongoDB, Redis, NATS JetStream, Meilisearch, MinIO)
packages/web    Next.js 15 (App Router) + React 19 frontend
```

Both are npm workspaces managed from this root.

## Getting started

```bash
npm install
npm run dev          # API (port 8000) + Web (port 3000), concurrently
```

Run a package individually:

```bash
npm run dev -w packages/api
npm run dev -w packages/web
```

## Common commands

| Command | What it does |
|---|---|
| `npm run build` | Build both packages |
| `npm test` | Run unit tests for both packages |
| `npm run lint` | Lint both packages |
| `npm run typecheck -w packages/web` | Type-check the frontend |
| `npx tsc -p tsconfig.json --noEmit` (from `packages/api`) | Type-check the backend |

Integration and E2E tests (Playwright) live under `packages/web` and
`packages/api`'s `tests/` tooling — see `.claude/scripts/run-all.sh` for the
full local QA pipeline (seed → lint → unit → integration → e2e).

## Architecture, in brief

- **Multi-tenancy**: every collection is scoped by `tenant_id`; tenant
  resolution comes from JWT, request header, or subdomain (see
  `packages/api/src/middleware/tenant.middleware.ts`).
- **Async processing**: ~30 NATS JetStream workers handle notifications,
  webhooks, AI agents, escalation, search indexing, alert evaluation, and
  more (`packages/api/src/workers/`).
- **AI**: a provider-agnostic layer (OpenAI / Anthropic / Google, configured
  per tenant) backs incident triage, RCA, postmortem drafts, guided
  resolution, and an agent framework for autonomous/semi-autonomous
  workflows (`packages/api/src/services/ai.service.ts`,
  `packages/api/src/services/agent-orchestrator.service.ts`).
- **MCP server**: a hosted Model Context Protocol endpoint (`/mcp`) lets an
  external AI assistant query incidents, tickets, alerts, on-call, and
  runbooks, and *propose* (never directly create) a ticket or change request
  for a human to approve (`packages/api/src/mcp/`).

## Where to look next

- `sreoncall-docs/01_FRD.md` — functional requirements and data models
- `sreoncall-docs/02_TDD.md` — technical design (backend/frontend architecture, workers, key decisions)
- `sreoncall-docs/03_ANSIBLE.md` — infrastructure/deployment guide
- `sreoncall-docs/agentic-platform-roadmap.md` — the agentic/AI-native platform vision
- `SECURITY.md` — secret handling, credential flow, and reporting a vulnerability
