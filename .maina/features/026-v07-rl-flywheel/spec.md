# Feature: v0.7.0 — RL Flywheel, Dashboard, Billing

## Problem Statement

Maina collects RL feedback locally (accept/reject on prompts) but it stays on the developer's machine. Teams can't see verification trends, prompt evolution, or usage. There's no recurring audit to catch regressions. No way to monetize the cloud service.

- Primary pain: RL data is siloed per-developer, no team-wide learning
- Secondary pain: no visibility into verification health across repos
- Tertiary pain: cloud service has no billing — unlimited free use is unsustainable

## Target User

- Primary: Engineering teams using maina cloud who want visibility into verification quality and prompt evolution
- Secondary: Solo developers who want automated daily audits with Copilot auto-fixes

## User Stories

- As a team lead, I want a dashboard showing verification pass rates and prompt A/B test results so I can track code quality trends.
- As a developer, I want daily audit findings auto-filed as GitHub issues so regressions are caught without manual runs.
- As a developer, I want `maina learn --cloud` to sync my RL data so the team benefits from everyone's feedback.
- As an admin, I want Stripe billing so I can manage my team's subscription tier.

## Success Criteria

- [ ] Daily audit cron runs maina verify + review + slop + learn on configured repos
- [ ] Findings create GitHub issues labeled `copilot` for auto-fix
- [ ] `POST /feedback/batch` accepts bulk RL data from `maina learn --cloud`
- [ ] Cloud aggregates prompt win rates per team, surfaces best-performing variants
- [ ] `maina learn --cloud` pushes local feedback, pulls team prompt improvements
- [ ] Dashboard at `/dashboard` shows: verification history, prompt A/B results, team usage
- [ ] Stripe Checkout integration with webhook for subscription management
- [ ] Three tiers enforced: Personal (free, 100/month), Team (paid, unlimited), Enterprise (custom)
- [ ] Reusable audit workflow that any repo can adopt

## Scope

### In Scope

**Sub-project 1: Daily Audit + Copilot Integration**
- `.github/workflows/daily-audit.yml` for maina and maina-cloud repos
- Runs maina verify, review, slop, stats, learn --no-interactive
- Creates GitHub issues with findings, labeled `audit` + `copilot`
- Reusable workflow pattern other repos can copy
- Copilot coding agent picks up labeled issues

**Sub-project 2: Cloud RL Endpoint + maina learn --cloud**
- `POST /feedback/batch` — bulk upload from local feedback.db
- D1 table: `feedback_events` (team_id, member_id, prompt_hash, command, accepted, context, diff_hash, timestamp)
- Aggregation queries: win rate per prompt_version per task per team
- `maina learn --cloud` CLI flag: push local → pull team improvements
- A/B test coordination: 90% current, 10% candidate, promote at >N trials + higher win rate

**Sub-project 3: Dashboard + Billing**
- Hono JSX + htmx pages served from maina-cloud at `/dashboard`
- 4 pages: overview (pass rate chart), prompts (A/B results), team (members + usage), billing (Stripe)
- Stripe Checkout for Team tier, webhook for subscription events
- D1 tables: `subscriptions` (team_id, stripe_customer_id, plan, status, current_period_end)
- Tier enforcement middleware: check plan limits before processing verification jobs

### Out of Scope

- Real-time WebSocket updates on dashboard
- Custom prompt editor in dashboard UI
- Cross-team learning (patterns from team A improving team B)
- Own model fine-tuning (needs data volume first)
- SSO / SAML (Enterprise, future)
- Self-hosted deployment (Enterprise, future)

## Design Decisions

1. **Hono JSX + htmx for dashboard** — no SPA framework, no build step, runs on Workers natively. Same pattern as device auth page. MVP ships fast.
2. **Stripe Checkout (not Elements)** — redirect to Stripe-hosted page. No PCI concerns, simplest integration.
3. **Three tiers: Personal/Team/Enterprise** — Personal is free (100 verifications/month), Team is paid (unlimited), Enterprise is custom.
4. **Batch feedback upload** — `maina learn --cloud` sends all local feedback in one POST, not per-event. Reduces API calls.
5. **A/B test in cloud** — cloud tracks which prompt variant was used and its outcome. Local client tags each AI call with prompt_hash. Cloud aggregates.

## Open Questions

None — all resolved during brainstorming.
