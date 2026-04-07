# v0.5.0 — Cloud Client + maina-cloud Private Repo

## Problem Statement

Maina is local-only. Prompts, feedback, and A/B test results live on one machine. Teams can't share learned prompts or coordinate prompt evolution. There's no infrastructure for the hosted verification, autonomous workflow, or self-improvement features planned for v0.6-v0.7.

## Architecture

Two repos, one API contract:

```
beeeku/maina (open source)          mainahq/maina-cloud (private)
├── packages/core/src/cloud/        ├── src/
│   ├── client.ts (API client)      │   ├── api/ (Workers routes)
│   ├── types.ts (shared types)     │   ├── db/ (D1 schemas)
│   └── auth.ts (OAuth device)      │   ├── auth/ (OAuth server)
├── packages/cli/src/commands/      │   └── sync/ (prompt sync)
│   ├── login.ts                    ├── wrangler.toml
│   ├── sync.ts                     ├── package.json
│   └── team.ts                     └── CLAUDE.md
```

## Scope — This Repo (beeeku/maina)

### Cloud API Client (`packages/core/src/cloud/`)

- `client.ts` — HTTP client for Maina Cloud API. Handles auth headers, retries, error envelopes.
- `types.ts` — Shared request/response types. Used by both CLI and cloud.
- `auth.ts` — GitHub OAuth device flow (client-side). Stores token in `~/.maina/auth.json`.

### CLI Commands

- `maina login` — GitHub OAuth device flow. Opens browser, polls for token, stores locally.
- `maina logout` — Removes stored credentials.
- `maina sync push` — Uploads local prompts + feedback to cloud.
- `maina sync pull` — Downloads team prompts, merges with local.
- `maina team` — Shows team members, roles, prompt sync status.

### Config

- `maina configure` gains cloud section: API URL, team ID.
- Default API URL: `https://api.mainahq.com` (configurable for self-hosted).

## Scope — Private Repo (maina-cloud)

### Scaffold at `mainahq/maina-cloud` (private repo)

- Bun + Workkit + Cloudflare Workers project
- Health check endpoint (`GET /health`)
- Auth endpoint (`POST /auth/device`, `POST /auth/token`)
- Prompt sync endpoints (`GET /prompts`, `PUT /prompts`)
- Team endpoints (`GET /team`, `POST /team/invite`)
- D1 schema: teams, members, prompts, feedback
- CLAUDE.md with project conventions

## Success Criteria

- [ ] maina-cloud repo exists at mainahq/maina-cloud with Workers service
- [ ] `wrangler dev` starts and `/health` returns 200
- [ ] Cloud API client in core can make authenticated requests
- [ ] `maina login` completes device flow and stores token in ~/.maina/auth.json
- [ ] `maina sync push` sends prompts to cloud API
- [ ] `maina sync pull` downloads and merges team prompts
- [ ] `maina team` displays team info from API
- [ ] All new code has tests
- [ ] Types are shared — same interfaces used by client and server

## Out of Scope

- Billing / Stripe (v0.7.0)
- Dashboard UI (v0.7.0)
- Hosted verification (v0.6.0)
- Autonomous workflow action (v0.6.0)
- Self-improvement action (v0.7.0)
