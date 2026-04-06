# Task Breakdown

## Tasks

Each task should be completable in one commit. Test tasks precede implementation tasks.

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
- [ ] T019: Add @workkit/ratelimit on /verify and /webhooks/github
- [ ] T020: Write tests for KV cache
- [ ] T021: Upgrade cache to @workkit/cache KV with SWR
- [ ] T022: Replace utils/crypto.ts with @workkit/crypto
- [ ] T023: Import types from @mainahq/core, delete duplicates

### Phase 6: GitHub Action (mainahq/verify-action)
- [ ] T024: Scaffold mainahq/verify-action repo
- [ ] T025: Write action.yml with inputs (token, base, cloud_url)
- [ ] T026: Implement src/index.ts: diff → submit → poll → exit code
- [ ] T027: Build with ncc, test locally
- [ ] T028: Tag and publish as v1

### Phase 7: Integration testing
- [ ] T029: E2E test: maina verify --cloud against staging
- [ ] T030: E2E test: GitHub Action in a test repo
- [ ] T031: E2E test: GitHub App webhook → commit status

## Dependencies

```
T001 → T002 → T003 (shared types)
T003 → T004-T008 (cloud client needs types)
T008 → T009-T011 (CLI needs client methods)
T003 → T012-T017 (Workflow needs types)
T017 → T018-T023 (workkit integrations after Workflow)
T008 → T024-T028 (Action needs cloud API)
T011 + T017 + T023 → T029-T031 (E2E needs everything)
```

Critical path: T001 → T002 → T003 → T004 → T007 → T009 → T011 → T029

## Definition of Done

- [ ] All tests pass (`bun run test`)
- [ ] Biome lint clean (`bun run check`)
- [ ] TypeScript compiles (`bun run typecheck`)
- [ ] `maina analyze` shows no errors
- [ ] `maina verify --cloud` round-trips against cloud API
- [ ] GitHub App webhook triggers verification and posts commit status
- [ ] `mainahq/verify-action@v1` published and tested in CI
- [ ] Rate limiting active on cloud endpoints
- [ ] Proof artifacts stored in R2
