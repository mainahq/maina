# v0.6.0 — Hosted Verification Design

**Date:** 2026-04-07
**Status:** Approved
**Issue:** mainahq/maina#43

---

## Problem

Verification runs locally only. CI pipelines, remote teams, and GitHub App integrations need hosted verification via API. The maina-cloud backend already has a working pipeline (parse-diff, build-context, ai-verify, store-proof, post-github) with a Durable Object orchestrator. What's missing is the client-side integration, production-grade orchestration, and a GitHub Action.

## Decision

Workers Workflows + D1 for pipeline orchestration (replacing the current Durable Object). Shared types from `@mainahq/core`. Commit status only for PR checks (no inline comments). GitHub Action as a thin wrapper.

## Scope

### Workstream 1: `maina verify --cloud` (maina repo)

**Files:** `packages/core/src/cloud/client.ts`, `packages/core/src/cloud/types.ts`, `packages/cli/src/commands/verify.ts`

Add `--cloud` flag to the existing verify command:

1. Build diff locally using existing git diff logic
2. Call `CloudClient.submitVerify({ diff, repo, baseBranch })` — returns `job_id`
3. Poll `CloudClient.getVerifyStatus(job_id)` — show step progress via clack spinner
4. Fetch full result via `CloudClient.getVerifyResult(job_id)` — returns `PipelineResult`
5. Render findings using the same table renderer as local verify

New `CloudClient` methods:

```typescript
submitVerify(payload: { diff: string; repo: string; baseBranch?: string }): Promise<Result<{ jobId: string }, string>>
getVerifyStatus(jobId: string): Promise<Result<{ status: JobStatus; currentStep: string }, string>>
getVerifyResult(jobId: string): Promise<Result<PipelineResult, string>>
```

### Workstream 2: Workers Workflow migration (maina-cloud)

**Files:** `src/do/verification-session.ts` (remove), new `src/workflows/verify.ts`, `src/api/verify.ts`

Replace Durable Object orchestration with Workers Workflows:

- Workflow definition with 5 named steps: `parse_diff` → `build_context` → `run_checks` → `ai_verify` → `store_proof`
- Each step updates `current_step` in D1 for status polling
- Built-in retry per step for transient failures
- `POST /verify` dispatches to Workflow instead of DO
- `post_github` runs as post-completion hook (best-effort, not a Workflow step)
- Remove `VerificationSession` Durable Object — D1 tracks all state

### Workstream 3: @workkit integrations (maina-cloud)

**Packages to add:** `@workkit/queue`, `@workkit/ratelimit`, `@workkit/cache`, `@workkit/crypto`

| Package | Usage |
|---------|-------|
| `@workkit/queue` | Workers Workflow orchestration for verification pipeline |
| `@workkit/ratelimit` | Middleware on `/verify` and `/webhooks/github`. Per-team limits (100 verifications/hour default) |
| `@workkit/cache` | SWR cache keyed on `team_id:diff_hash:prompt_version`. Upgrade from D1 lookup to KV for speed |
| `@workkit/crypto` | Replace manual sha256/HMAC in `utils/crypto.ts` |
| `@workkit/ai` | Not applicable — wraps Workers AI (Cloudflare models), not Claude. Keep raw Anthropic SDK in `ai-verify.ts` |

### Workstream 4: Shared types (maina repo → maina-cloud)

**Files:** `packages/core/src/verify/types.ts` (new public export), maina-cloud `src/types.ts`

Export from `@mainahq/core`:
- `Finding` — `{ tool, file, line, column?, message, severity, ruleId? }`
- `PipelineResult` — `{ passed, findings, tools, duration, cacheHits, ... }`
- `ToolReport` — per-tool result
- `DetectedTool` — tool availability

maina-cloud imports these as `import type` only (no runtime deps from core). Cloud deletes its duplicate `Finding` type.

### Workstream 5: `mainahq/verify-action` (new repo)

New GitHub Action repository:

```yaml
inputs:
  token:     # MAINA_TOKEN (required)
  base:      # base branch (default: main)
  cloud_url: # API URL (default: https://api.mainahq.com)
```

Steps:
1. Compute diff (`git diff $base...HEAD`)
2. `POST /verify` with diff + repo name
3. Poll `GET /verify/:id/status` until done/failed
4. Parse result — set step outputs (`passed`, `findings_count`, `proof_url`)
5. Exit 0 if passed, exit 1 if failed

TypeScript compiled to single JS file via `ncc`. Published as `mainahq/verify-action@v1`.

## Cache Strategy

Key: `team_id:diff_hash:prompt_version`

- Cache hit → return existing `job_id` immediately (no re-run)
- Cache miss → create new job, run pipeline
- `diff_hash` = sha256 of the unified diff payload
- `prompt_version` = hash of team's constitution + custom prompts
- Stored in KV via `@workkit/cache` with SWR semantics

## Not In Scope

- Container execution for heavy tools (enterprise, future)
- Inline PR review comments (just commit status)
- Dashboard / billing (v0.7.0)
- `mainahq/workflow-action` autonomous coding (v0.7.0+)
- New D1 tables (existing schema covers all needs)

## Architecture

```
PR opened / maina verify --cloud / GitHub Action
        │
        ▼
  POST /verify  (Hono route, @workkit/ratelimit)
        │
        ▼
  Cache check (@workkit/cache)
  team_id:diff_hash:prompt_version
        │
   hit? ─── yes ──→ return cached job_id
        │
        no
        ▼
  Create job in D1 (status: "queued")
  Dispatch to Workers Workflow (@workkit/queue)
        │
        ▼
  ┌─────────────────────────────────────┐
  │  Verification Workflow (5 steps)    │
  │                                     │
  │  1. parse_diff    → DiffFile[]      │
  │  2. build_context → conventions     │
  │  3. run_checks    → slop+consistency│
  │  4. ai_verify     → Claude findings │
  │  5. store_proof   → R2 artifact     │
  └──────────────────┬──────────────────┘
                     │
                     ▼
  Update D1 (status: "done", findings_json, passed)
        │
        ▼
  If PR job → post commit status (best-effort)
```

## Success Criteria

- [ ] `maina verify --cloud` submits diff, polls, returns findings locally
- [ ] Workers Workflow runs 5-step pipeline with per-step status tracking
- [ ] Cache hit on same diff + prompt version returns instantly
- [ ] GitHub App webhook triggers verification on PR open/sync → commit status
- [ ] `mainahq/verify-action@v1` works in CI with `MAINA_TOKEN`
- [ ] Rate limiting prevents abuse (per-team, 100/hour default)
- [ ] Proof artifacts stored and retrievable from R2
- [ ] Types shared from `@mainahq/core` — no duplication
