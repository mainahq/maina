# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Three sub-projects, two repos. All feed into the same flywheel.

```
┌──────────────────────────────────────────────────────────────┐
│  Daily Audit (GitHub Actions cron)                           │
│  maina verify → review → slop → learn → GitHub Issue        │
│                                              ↓               │
│                                     Copilot auto-fix PR      │
│                                              ↓               │
│                                     maina verify on PR       │
│                                     (via GitHub App v0.6.0)  │
└──────────────────────────────┬───────────────────────────────┘
                               │ feedback
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Cloud RL (maina-cloud)                                      │
│  POST /feedback/batch ← maina learn --cloud                  │
│  D1: feedback_events table                                   │
│  Aggregation: win rate per prompt per task per team           │
│  GET /feedback/improvements → pull best variants             │
└──────────────────────────────┬───────────────────────────────┘
                               │ metrics
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Dashboard (maina-cloud /dashboard)                          │
│  Hono JSX + htmx                                             │
│  Pages: overview, prompts, team, billing                     │
│  Stripe Checkout + webhooks                                  │
│  Tier enforcement middleware                                 │
└──────────────────────────────────────────────────────────────┘
```

## Key Technical Decisions

- **Hono JSX** for dashboard — `hono/jsx` built-in, no React/build needed
- **htmx** for interactivity — loaded via CDN, partial page updates
- **Stripe Checkout** — redirect flow, webhook for subscription lifecycle
- **D1** for all storage — feedback_events, subscriptions tables
- **Batch API** — `POST /feedback/batch` accepts array of events, single transaction

## Files

### maina repo (beeeku/maina)

| File | Purpose | New/Modified |
|------|---------|-------------|
| `.github/workflows/daily-audit.yml` | Cron workflow for daily audit | New |
| `packages/core/src/cloud/client.ts` | Add postFeedbackBatch, getFeedbackImprovements | Modified |
| `packages/core/src/cloud/types.ts` | Add FeedbackEvent, FeedbackBatchPayload, PromptImprovement types | Modified |
| `packages/core/src/feedback/sync.ts` | Export local feedback.db data for cloud upload | New |
| `packages/cli/src/commands/learn.ts` | Add --cloud flag: push feedback, pull improvements | Modified |

### maina-cloud repo (beeeku/maina-cloud)

| File | Purpose | New/Modified |
|------|---------|-------------|
| `src/api/feedback.ts` | POST /feedback/batch, GET /feedback/improvements | New |
| `src/api/dashboard.ts` | GET /dashboard/* — Hono JSX pages | New |
| `src/api/billing.ts` | POST /billing/checkout, POST /billing/webhook | New |
| `src/views/layout.tsx` | Shared dashboard layout (Hono JSX) | New |
| `src/views/overview.tsx` | Verification history + pass rate chart | New |
| `src/views/prompts.tsx` | A/B test results table | New |
| `src/views/team.tsx` | Team members + usage | New |
| `src/views/billing.tsx` | Subscription management | New |
| `src/middleware/tier.ts` | Plan limit enforcement middleware | New |
| `src/db/schema.sql` | Add feedback_events, subscriptions tables | Modified |
| `src/types.ts` | Add subscription/feedback types | Modified |

## Tasks

TDD: every implementation task must have a preceding test task.

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

## Failure Modes

| Failure | Handling |
|---------|----------|
| Feedback batch too large | 413 with max batch size (1000 events) |
| Stripe webhook signature invalid | 401, logged, not processed |
| Stripe API down | Checkout fails gracefully, existing subscriptions unaffected |
| Dashboard auth expired | Redirect to /device login |
| No feedback data yet | Dashboard shows empty state with onboarding guidance |
| Daily audit finds nothing | No issue created, silent success |
| Copilot doesn't pick up issue | Human can still fix — issue is a normal GitHub issue |

## Testing Strategy

- **Unit tests** for all endpoints, middleware, views
- **Integration tests** for feedback → aggregation → improvements flow
- **E2E tests** for Stripe checkout flow (test mode)
- **Mocks:** D1 via @workkit/testing, Stripe via test API keys, fetch for client tests
