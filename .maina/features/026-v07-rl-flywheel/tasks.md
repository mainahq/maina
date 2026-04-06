# Task Breakdown

## Tasks

Each task should be completable in one commit. Test tasks precede implementation tasks.

### Phase 1: Daily Audit Workflow (maina repo)
- [ ] T001: Create .github/workflows/daily-audit.yml for beeeku/maina
- [ ] T002: Create .github/workflows/daily-audit.yml for beeeku/maina-cloud
- [ ] T003: Test workflow locally with act or manual dispatch

### Phase 2: Cloud RL Endpoint (maina-cloud)
- [ ] T004: Write tests for POST /feedback/batch
- [ ] T005: Add feedback_events table to D1 schema
- [ ] T006: Implement POST /feedback/batch endpoint
- [ ] T007: Write tests for GET /feedback/improvements
- [ ] T008: Implement GET /feedback/improvements (aggregation queries)
- [ ] T009: Add rate limiting on feedback endpoints

### Phase 3: maina learn --cloud (maina repo)
- [ ] T010: Write tests for feedback sync (export local → cloud format)
- [ ] T011: Create packages/core/src/feedback/sync.ts
- [ ] T012: Write tests for CloudClient.postFeedbackBatch and getFeedbackImprovements
- [ ] T013: Add postFeedbackBatch, getFeedbackImprovements to CloudClient
- [ ] T014: Write tests for learn --cloud flow
- [ ] T015: Add --cloud flag to learn command

### Phase 4: Dashboard UI (maina-cloud)
- [ ] T016: Create shared layout with Hono JSX (header, nav, htmx)
- [ ] T017: Write tests for /dashboard routes (auth required, returns HTML)
- [ ] T018: Implement overview page (verification history, pass rate)
- [ ] T019: Implement prompts page (A/B test results)
- [ ] T020: Implement team page (members, usage stats)
- [ ] T021: Implement billing page (current plan, upgrade link)

### Phase 5: Stripe Billing (maina-cloud)
- [ ] T022: Write tests for billing checkout + webhook endpoints
- [ ] T023: Add subscriptions table to D1 schema
- [ ] T024: Implement POST /billing/checkout (Stripe Checkout session)
- [ ] T025: Implement POST /billing/webhook (Stripe webhook handler)
- [ ] T026: Implement tier enforcement middleware
- [ ] T027: Apply tier middleware to /verify endpoint

### Phase 6: Integration + E2E
- [ ] T028: E2E: daily audit workflow creates issue on findings
- [ ] T029: E2E: maina learn --cloud pushes feedback, pulls improvements
- [ ] T030: E2E: dashboard renders with real data
- [ ] T031: E2E: Stripe checkout → subscription → tier enforcement

## Dependencies

```
T001-T003 (audit workflow) — independent, can start immediately
T004-T009 (cloud RL) — independent, can start immediately
T010-T015 (learn --cloud) — depends on T006+T008 (cloud endpoints)
T016-T021 (dashboard) — depends on T008 (needs data to display)
T022-T027 (billing) — depends on T016 (needs dashboard for billing page)
T028-T031 (E2E) — depends on all above
```

Critical path: T004 → T006 → T010 → T013 → T015 → T029

Parallelizable: Phase 1 || Phase 2 || Phase 4 (layout only)

## Definition of Done

- [ ] All tests pass (bun run test in both repos)
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] maina analyze shows no errors
- [ ] Daily audit workflow runs successfully on manual dispatch
- [ ] maina learn --cloud round-trips feedback to cloud
- [ ] Dashboard renders at api.mainahq.com/dashboard
- [ ] Stripe Checkout completes in test mode
- [ ] Tier limits enforced on /verify
