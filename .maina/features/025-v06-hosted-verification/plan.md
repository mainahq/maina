# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Three repos, one pipeline. CLI submits diff → cloud runs Workflow → returns findings.

```
maina verify --cloud
  │
  ├─ CloudClient.submitVerify() ──→ POST /verify (maina-cloud)
  │                                      │
  │                                      ▼
  │                                 Cache check (KV)
  │                                      │
  │                                 Workers Workflow:
  │                                   1. parse_diff
  │                                   2. build_context
  │                                   3. run_checks (slop + consistency)
  │                                   4. ai_verify (Claude)
  │                                   5. store_proof (R2)
  │                                      │
  ├─ CloudClient.getVerifyStatus() ←─── D1 status polling
  │
  └─ CloudClient.getVerifyResult() ←─── Final PipelineResult
```

- Pattern: Workers Workflows for orchestration, D1 for state, KV for cache, R2 for proofs
- Integration points: `packages/core/src/cloud/client.ts`, `packages/cli/src/commands/verify.ts`

## Key Technical Decisions

- **Workers Workflows** via `@workkit/queue` — native CF orchestration with retry/timeout per step
- **Remove Durable Object** — D1 tracks all state, DO is redundant
- **`import type` only** — maina-cloud imports types from `@mainahq/core` without runtime deps
- **`ncc`** for GitHub Action — single-file JS bundle, no node_modules in the action repo
- **Anthropic SDK** stays for AI verify — `@workkit/ai` is for Workers AI (Cloudflare models), not Claude

## Files

### maina repo (this repo)

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/cloud/client.ts` | Add submitVerify, getVerifyStatus, getVerifyResult | Modified |
| `packages/core/src/cloud/types.ts` | Add SubmitVerifyPayload, VerifyStatusResponse, VerifyResultResponse | Modified |
| `packages/core/src/verify/types.ts` | Export Finding, PipelineResult, ToolReport, DetectedTool as public API | New |
| `packages/core/src/index.ts` | Re-export verify types | Modified |
| `packages/cli/src/commands/verify.ts` | Add --cloud flag, polling logic, cloud result rendering | Modified |

### maina-cloud repo (/Users/Bikash/try/maina-cloud)

| File | Purpose | New/Modified |
|------|---------|-------------|
| `src/workflows/verify.ts` | Workers Workflow: 5-step verification pipeline | New |
| `src/api/verify.ts` | Dispatch to Workflow instead of DO, add rate limiting | Modified |
| `src/api/webhooks.ts` | Dispatch to Workflow instead of DO | Modified |
| `src/do/verification-session.ts` | Remove (replaced by Workflow) | Deleted |
| `src/types.ts` | Remove duplicate Finding, import from @mainahq/core | Modified |
| `src/middleware/ratelimit.ts` | Rate limit middleware via @workkit/ratelimit | New |
| `src/utils/crypto.ts` | Replace with @workkit/crypto | Modified |
| `wrangler.toml` | Add Workflow binding, remove DO binding | Modified |

### verify-action repo (new: mainahq/verify-action)

| File | Purpose | New/Modified |
|------|---------|-------------|
| `src/index.ts` | Action entry: diff → submit → poll → exit code | New |
| `action.yml` | Action metadata (inputs: token, base, cloud_url) | New |
| `package.json` | Dependencies: @actions/core, @actions/exec | New |
| `tsconfig.json` | TypeScript config | New |

## Tasks

TDD: every implementation task must have a preceding test task.

### Phase 1: Shared types (maina repo)
- [ ] T001: Write tests for verify type exports from @mainahq/core
- [ ] T002: Create packages/core/src/verify/types.ts, export Finding/PipelineResult/ToolReport/DetectedTool
- [ ] T003: Re-export from packages/core/src/index.ts

### Phase 2: Cloud client methods (maina repo)
- [ ] T004: Write tests for CloudClient.submitVerify
- [ ] T005: Write tests for CloudClient.getVerifyStatus
- [ ] T006: Write tests for CloudClient.getVerifyResult
- [ ] T007: Implement submitVerify, getVerifyStatus, getVerifyResult in client.ts
- [ ] T008: Add types to cloud/types.ts

### Phase 3: CLI --cloud flag (maina repo)
- [ ] T009: Write tests for verify --cloud flow (submit, poll, render)
- [ ] T010: Add --cloud option to verify command
- [ ] T011: Implement cloud verify flow: submit → poll with spinner → render findings

### Phase 4: Workers Workflow (maina-cloud)
- [ ] T012: Write tests for Workflow step functions
- [ ] T013: Create src/workflows/verify.ts with 5 Workflow steps
- [ ] T014: Update src/api/verify.ts to dispatch to Workflow
- [ ] T015: Update src/api/webhooks.ts to dispatch to Workflow
- [ ] T016: Remove src/do/verification-session.ts
- [ ] T017: Update wrangler.toml bindings

### Phase 5: @workkit integrations (maina-cloud)
- [ ] T018: Write tests for rate limit middleware
- [ ] T019: Add @workkit/ratelimit middleware on /verify and /webhooks/github
- [ ] T020: Write tests for KV cache hit/miss
- [ ] T021: Upgrade cache from D1 lookup to @workkit/cache KV with SWR
- [ ] T022: Replace utils/crypto.ts with @workkit/crypto
- [ ] T023: Import types from @mainahq/core, remove duplicate Finding type

### Phase 6: GitHub Action (new repo)
- [ ] T024: Scaffold mainahq/verify-action repo
- [ ] T025: Write action.yml with inputs (token, base, cloud_url)
- [ ] T026: Implement src/index.ts: diff → submit → poll → exit code
- [ ] T027: Build with ncc, test locally
- [ ] T028: Tag and publish as v1

### Phase 7: Integration testing
- [ ] T029: E2E test: maina verify --cloud against staging
- [ ] T030: E2E test: GitHub Action in a test repo
- [ ] T031: E2E test: GitHub App webhook → commit status

## Failure Modes

| Failure | Handling |
|---------|----------|
| Cloud API unreachable | `--cloud` falls back to local verify with warning |
| Workflow step fails (transient) | Built-in Workflow retry (3 attempts, exponential backoff) |
| Workflow step fails (permanent) | Job marked "failed" in D1, client gets error response |
| AI verify returns unparseable JSON | Skip AI findings, return partial result with warning |
| Cache KV unavailable | Fall through to full pipeline run |
| Rate limit exceeded | 429 response, client shows "rate limited, retry in Xs" |
| GitHub API failure (post status) | Best-effort, logged but doesn't fail the job |
| R2 write failure | Job still completes, proof_key is null, logged |

## Testing Strategy

- **Unit tests** for all new functions (CloudClient methods, Workflow steps, Action logic)
- **Integration tests** for cloud client against mock HTTP server
- **E2E tests** for full pipeline: CLI → cloud → result
- **Mocks needed:** fetch (for CloudClient tests), D1/KV/R2 (via @workkit/testing)
