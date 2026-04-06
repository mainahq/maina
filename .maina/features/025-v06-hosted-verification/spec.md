# Feature: v0.6.0 Hosted Verification

## Problem Statement

Verification runs locally only. CI pipelines can't use maina without installing all tools. Remote teams need hosted verification via API. GitHub App integrations need to auto-verify PRs and post commit status. Without this, maina is limited to solo developer use on local machines.

- Primary pain: no CI integration, no team-wide verification without local setup
- Secondary pain: GitHub PRs lack automated maina verification

## Target User

- Primary: Engineering teams using CI/CD who want maina verification in their pipeline without installing tools on every runner
- Secondary: Solo developers who want GitHub App auto-verification on PRs

## User Stories

- As a team lead, I want `maina verify --cloud` so that CI runners verify code without installing semgrep/trivy/etc locally.
- As a developer, I want PRs auto-verified by maina via GitHub App so that every PR gets consistent verification.
- As a DevOps engineer, I want a `mainahq/verify-action` GitHub Action so that I can add maina to any CI workflow in one line.

## Success Criteria

- [ ] `maina verify --cloud` submits diff, polls with progress spinner, returns findings locally
- [ ] Workers Workflow runs 5-step pipeline with per-step status tracking in D1
- [ ] Cache hit on same `team_id:diff_hash:prompt_version` returns instantly
- [ ] GitHub App webhook triggers verification on PR open/sync, posts commit status
- [ ] `mainahq/verify-action@v1` works in CI with `MAINA_TOKEN`
- [ ] Rate limiting on `/verify` and `/webhooks/github` (per-team, 100/hour default)
- [ ] Proof artifacts stored and retrievable from R2
- [ ] Types shared from `@mainahq/core` — no duplication in maina-cloud

## Scope

### In Scope

- `--cloud` flag on `maina verify` command (maina repo)
- `CloudClient.submitVerify/getVerifyStatus/getVerifyResult` methods (maina repo)
- Shared type exports: `Finding`, `PipelineResult`, `ToolReport`, `DetectedTool` from `@mainahq/core`
- Workers Workflow migration replacing Durable Object (maina-cloud)
- `@workkit/ratelimit` middleware on API endpoints (maina-cloud)
- `@workkit/cache` SWR keyed on `team_id:diff_hash:prompt_version` (maina-cloud)
- `@workkit/crypto` replacing manual sha256/HMAC (maina-cloud)
- `mainahq/verify-action` GitHub Action (new repo)

### Out of Scope

- Container execution for heavy tools (enterprise, future)
- Inline PR review comments (commit status only for now)
- Dashboard / billing (v0.7.0)
- `mainahq/workflow-action` autonomous coding (v0.7.0+)
- New storage schemas

## Design Decisions

1. **Workers Workflows + D1 over Durable Objects** — Workflows provide built-in retry, step-level observability, and timeout handling. DO added complexity without benefit since D1 already tracks job state. Simplifies the architecture.

2. **AI-only verification on cloud (for now)** — Workers can't spawn binaries (semgrep, trivy). Cloud runs parse_diff → build_context → slop/consistency (regex, no binary) → AI verify → store proof. Container execution for heavy tools is a future enterprise feature.

3. **Commit status only, no inline comments** — Minimal surface area. Clean pass/fail check with summary link. Inline PR comments deferred.

4. **Shared types from `@mainahq/core`** — One source of truth. Cloud uses `import type` only (no runtime deps). Eliminates drift between local and cloud Finding types.

5. **Cache key: `team_id:diff_hash:prompt_version`** — Matches local cache strategy. Re-runs if team updates constitution/prompts. KV via `@workkit/cache` for speed over D1 lookup.

## Open Questions

None — all resolved during brainstorming.

## Design Spec

Full design: `docs/superpowers/specs/2026-04-07-v060-hosted-verification-design.md`
