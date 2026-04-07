# Feature: Implementation Plan

## Scope

### In Scope - `--cloud` flag on `maina verify` command (maina repo) - `CloudClient.submitVerify/getVerifyStatus/getVerifyResult` methods (maina repo) - Shared type exports: `Finding`, `PipelineResult`, `ToolReport`, `DetectedTool` from `@mainahq/core` - Workers Workflow migration replacing Durable Object (maina-cloud) - `@workkit/ratelimit` middleware on API endpoints (maina-cloud) - `@workkit/cache` SWR keyed on `team_id:diff_hash:prompt_version` (maina-cloud) - `@workkit/crypto` replacing manual sha256/HMAC (maina-cloud) - `mainahq/verify-action` GitHub Action (new repo) ### Out of Scope - Container execution for heavy tools (enterprise, future) - Inline PR review comments (commit status only for now) - Dashboard / billing (v0.7.0) - `mainahq/workflow-action` autonomous coding (v0.7.0+) - New storage schemas

## Tasks

Progress: 0/31 (0%)

- [ ] T001: Write tests for verify type exports from @mainahq/core
- [ ] T002: Create packages/core/src/verify/types.ts, export Finding/PipelineResult/ToolReport/DetectedTool
- [ ] T003: Re-export from packages/core/src/index.ts
- [ ] T004: Write tests for CloudClient.submitVerify
- [ ] T005: Write tests for CloudClient.getVerifyStatus
- [ ] T006: Write tests for CloudClient.getVerifyResult
- [ ] T007: Implement submitVerify, getVerifyStatus, getVerifyResult in client.ts
- [ ] T008: Add types to cloud/types.ts
- [ ] T009: Write tests for verify --cloud flow (submit, poll, render)
- [ ] T010: Add --cloud option to verify command
- [ ] T011: Implement cloud verify flow: submit → poll with spinner → render findings
- [ ] T012: Write tests for Workflow step functions
- [ ] T013: Create src/workflows/verify.ts with 5 Workflow steps
- [ ] T014: Update src/api/verify.ts to dispatch to Workflow
- [ ] T015: Update src/api/webhooks.ts to dispatch to Workflow
- [ ] T016: Remove src/do/verification-session.ts
- [ ] T017: Update wrangler.toml bindings
- [ ] T018: Write tests for rate limit middleware
- [ ] T019: Add @workkit/ratelimit on /verify and /webhooks/github
- [ ] T020: Write tests for KV cache
- [ ] T021: Upgrade cache to @workkit/cache KV with SWR
- [ ] T022: Replace utils/crypto.ts with @workkit/crypto
- [ ] T023: Import types from @mainahq/core, delete duplicates
- [ ] T024: Scaffold mainahq/verify-action repo
- [ ] T025: Write action.yml with inputs (token, base, cloud_url)
- [ ] T026: Implement src/index.ts: diff → submit → poll → exit code
- [ ] T027: Build with ncc, test locally
- [ ] T028: Tag and publish as v1
- [ ] T029: E2E test: maina verify --cloud against staging
- [ ] T030: E2E test: GitHub Action in a test repo
- [ ] T031: E2E test: GitHub App webhook → commit status

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
