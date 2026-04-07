# Feature: Implementation Plan

## Scope

### In Scope **Sub-project 1: Daily Audit + Copilot Integration** - `.github/workflows/daily-audit.yml` for maina and maina-cloud repos - Runs maina verify, review, slop, stats, learn --no-interactive - Creates GitHub issues with findings, labeled `audit` + `copilot` - Reusable workflow pattern other repos can copy - Copilot coding agent picks up labeled issues **Sub-project 2: Cloud RL Endpoint + maina learn --cloud** - `POST /feedback/batch` — bulk upload from local feedback.db - D1 table: `feedback_events` (team_id, member_id, prompt_hash, command, accepted, context, diff_hash, timestamp) - Aggregation queries: win rate per prompt_version per task per team - `maina learn --cloud` CLI flag: push local → pull team improvements - A/B test coordination: 90% current, 10% candidate, promote at >N trials + higher win rate **Sub-project 3: Dashboard + Billing** - Hono JSX + htmx pages served from maina-cloud at `/dashboard` - 4 pages: overview (pass rate chart), prompts (A/B results), team (members + usage), billing (Stripe) - Stripe Checkout for Team tier, webhook for subscription events - D1 tables: `subscriptions` (team_id, stripe_customer_id, plan, status, current_period_end) - Tier enforcement middleware: check plan limits before processing verification jobs ### Out of Scope - Real-time WebSocket updates on dashboard - Custom prompt editor in dashboard UI - Cross-team learning (patterns from team A improving team B) - Own model fine-tuning (needs data volume first) - SSO / SAML (Enterprise, future) - Self-hosted deployment (Enterprise, future)

## Tasks

Progress: 0/31 (0%)

- [ ] T001: Create .github/workflows/daily-audit.yml for beeeku/maina
- [ ] T002: Create .github/workflows/daily-audit.yml for beeeku/maina-cloud
- [ ] T003: Test workflow locally with act or manual dispatch
- [ ] T004: Write tests for POST /feedback/batch
- [ ] T005: Add feedback_events table to D1 schema
- [ ] T006: Implement POST /feedback/batch endpoint
- [ ] T007: Write tests for GET /feedback/improvements
- [ ] T008: Implement GET /feedback/improvements (aggregation queries)
- [ ] T009: Add rate limiting on feedback endpoints
- [ ] T010: Write tests for feedback sync (export local → cloud format)
- [ ] T011: Create packages/core/src/feedback/sync.ts
- [ ] T012: Write tests for CloudClient.postFeedbackBatch and getFeedbackImprovements
- [ ] T013: Add postFeedbackBatch, getFeedbackImprovements to CloudClient
- [ ] T014: Write tests for learn --cloud flow
- [ ] T015: Add --cloud flag to learn command
- [ ] T016: Create shared layout with Hono JSX (header, nav, htmx)
- [ ] T017: Write tests for /dashboard routes (auth required, returns HTML)
- [ ] T018: Implement overview page (verification history, pass rate)
- [ ] T019: Implement prompts page (A/B test results)
- [ ] T020: Implement team page (members, usage stats)
- [ ] T021: Implement billing page (current plan, upgrade link)
- [ ] T022: Write tests for billing checkout + webhook endpoints
- [ ] T023: Add subscriptions table to D1 schema
- [ ] T024: Implement POST /billing/checkout (Stripe Checkout session)
- [ ] T025: Implement POST /billing/webhook (Stripe webhook handler)
- [ ] T026: Implement tier enforcement middleware
- [ ] T027: Apply tier middleware to /verify endpoint
- [ ] T028: E2E: daily audit workflow creates issue on findings
- [ ] T029: E2E: maina learn --cloud pushes feedback, pulls improvements
- [ ] T030: E2E: dashboard renders with real data
- [ ] T031: E2E: Stripe checkout → subscription → tier enforcement

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
