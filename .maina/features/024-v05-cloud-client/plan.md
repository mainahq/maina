# Implementation Plan — v0.5.0 Cloud Client + maina-cloud

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Two parallel tracks: cloud API client in this repo, Workers service in mainahq/maina-cloud. Shared types ensure contract consistency.

## Key Technical Decisions

- **GitHub OAuth device flow** — works in CLI without browser redirect server
- **Workkit for cloud** — @workkit/d1, @workkit/kv, @workkit/auth, @workkit/api
- **Result<T, E> for API client** — consistent with rest of codebase
- **~/.maina/auth.json** for token storage — not in project .maina/ (user-level, not project-level)

## Files

### This repo (beeeku/maina)

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/cloud/client.ts` | HTTP API client | New |
| `packages/core/src/cloud/types.ts` | Shared API types | New |
| `packages/core/src/cloud/auth.ts` | OAuth device flow client | New |
| `packages/core/src/cloud/__tests__/client.test.ts` | Client tests | New |
| `packages/core/src/cloud/__tests__/auth.test.ts` | Auth tests | New |
| `packages/cli/src/commands/login.ts` | maina login/logout | New |
| `packages/cli/src/commands/sync.ts` | maina sync push/pull | New |
| `packages/cli/src/commands/team.ts` | maina team | New |
| `packages/cli/src/commands/__tests__/login.test.ts` | Login tests | New |
| `packages/cli/src/commands/__tests__/sync.test.ts` | Sync tests | New |
| `packages/cli/src/program.ts` | Register new commands | Modified |
| `packages/core/src/index.ts` | Export cloud module | Modified |

### Private repo (maina-cloud)

| File | Purpose | New |
|------|---------|-----|
| `package.json` | Bun + Workkit deps | New |
| `wrangler.toml` | CF Workers config | New |
| `tsconfig.json` | TypeScript strict | New |
| `biome.json` | Linter config | New |
| `CLAUDE.md` | Project conventions | New |
| `src/index.ts` | Workers entrypoint | New |
| `src/api/health.ts` | GET /health | New |
| `src/api/auth.ts` | POST /auth/device, /auth/token | New |
| `src/api/prompts.ts` | GET/PUT /prompts | New |
| `src/api/team.ts` | GET /team, POST /team/invite | New |
| `src/db/schema.ts` | D1 schemas | New |
| `src/__tests__/health.test.ts` | Health endpoint test | New |

## Tasks

### Track 1: Cloud client (this repo)

- [ ] T1.1: Create cloud/types.ts — shared API types
- [ ] T1.2: Create cloud/client.ts — HTTP client with auth, retries, Result<T, E>
- [ ] T1.3: Write tests for client.ts
- [ ] T1.4: Create cloud/auth.ts — OAuth device flow
- [ ] T1.5: Write tests for auth.ts
- [ ] T1.6: Create login.ts CLI command — maina login/logout
- [ ] T1.7: Create sync.ts CLI command — maina sync push/pull
- [ ] T1.8: Create team.ts CLI command — maina team
- [ ] T1.9: Register commands in program.ts, export from index.ts
- [ ] T1.10: maina verify + maina commit

### Track 2: maina-cloud private repo

- [ ] T2.1: Scaffold repo at mainahq/maina-cloud — Bun, Workkit, wrangler.toml
- [ ] T2.2: Create Workers entrypoint + health endpoint
- [ ] T2.3: Create D1 schema — teams, members, prompts, feedback tables
- [ ] T2.4: Create auth endpoints — device flow + token exchange
- [ ] T2.5: Create prompts endpoints — GET/PUT with D1
- [ ] T2.6: Create team endpoints — GET team, POST invite
- [ ] T2.7: Write tests
- [ ] T2.8: CLAUDE.md + biome.json + commit

## Testing Strategy

- **Client tests**: Mock fetch, test retry logic, auth header injection, error handling
- **Auth tests**: Mock device flow polling, token storage
- **CLI tests**: Mock cloud client, test command output
- **Cloud tests**: Workkit testing utilities for Workers
