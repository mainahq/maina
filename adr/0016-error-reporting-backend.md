# 0016. Error and telemetry backend (PostHog)

Date: 2026-04-17

## Status

Accepted

## Context

Maina needs crash reporting, usage telemetry, and product analytics for both the open-source CLI and the Cloud service. Requirements:

- OSS: opt-in, aggressive PII scrubbing, zero data until consent
- Cloud: opt-out (default on), account-linked for support triage
- Single platform preferred over stitching multiple backends together

## Decision

Use **PostHog** as the single backend for errors, usage telemetry, and product analytics.

- **Cloud**: PostHog Cloud (EU hosting available, generous free tier — 1M events/mo)
- **OSS**: PostHog Cloud with aggressive client-side scrubbing (same SDK, same project, scrubbed before send)
- **One SDK**: `posthog-node` for all server-side events
- **Fallback**: If PostHog's error tracking proves insufficient for stack trace depth or source map support, evaluate adding Sentry alongside — but start with one platform

### Why PostHog Over Sentry + Separate Analytics

| Concern | PostHog | Sentry + PostHog/Mixpanel |
|---------|---------|---------------------------|
| Backends to maintain | 1 | 2-3 |
| SDKs in code | 1 (`posthog-node`) | 2+ (`@sentry/node` + `posthog-node`) |
| Error tracking | Good (newer, improving) | Best-in-class (Sentry) |
| Usage analytics | Built-in (funnels, retention) | Need separate tool |
| Feature flags | Built-in | Need separate tool |
| Free tier | 1M events/mo | Sentry 5k + PostHog 1M |
| Self-hostable | Yes (MIT, Docker) | Sentry is heavy (Kafka, ClickHouse) |
| Cost at 100k errors + 500k events/mo | Free tier | ~$89/mo (Sentry) + free (PostHog) |

**One platform beats two.** PostHog's error tracking is good enough to start. If we outgrow it, Sentry is a clean add — but we don't pay the complexity tax upfront.

### Events Schema

**Error events** (crash reports):
- `maina.error` — error class, scrubbed message, scrubbed stack trace, command, OS, Maina version, anonymized agent identifier

**Usage events** (telemetry):
- `maina.install` — OS, runtime, Maina version
- `maina.verify.started` / `.completed` — tool count, duration, pass/fail
- `maina.learn.ran` — rules proposed, rules accepted
- `maina.commit` — verify pass/fail, tool count

All events are anonymous. PII scrubbing runs client-side before network send.

### Consent Model

- **OSS**: Single prompt at first run — "Share anonymous usage data to help improve Maina? [y/N]". Stored in `~/.maina/config.yml`. `maina telemetry off` permanently disables.
- **Cloud**: Default on. Opt-out via dashboard settings. Opt-out is immediate.
- Error reporting and usage telemetry share one consent toggle (one backend = one toggle).

## Cost Model

| Scale | PostHog Cloud |
|-------|---------------|
| Early (< 1M events/mo) | Free |
| Growth (1M-5M events/mo) | ~$0-450/mo (usage-based) |
| Scale (10M+ events/mo) | Self-hosted option available |

## Alternatives Considered

| Option | Verdict |
|--------|---------|
| Sentry (managed) | Best error tracking but 5k free tier, need separate analytics tool — rejected as primary |
| Sentry + PostHog | Two backends, two SDKs, more ops — rejected for now, Sentry as fallback if needed |
| GlitchTip | Never used, smaller ecosystem, error-only — rejected |
| Highlight.io | Newer, smaller community — not evaluated |
| **PostHog (unified)** | **Accepted** — one platform for errors + analytics + feature flags |

## Implementation

1. `posthog-node` SDK in `packages/core/src/telemetry/`
2. Project token set at build time via environment variable
3. PII scrubbing library runs client-side before any event send (see #120)
4. OSS: consent prompt at first run, `~/.maina/config.yml`
5. Cloud: default on, opt-out via dashboard + API
6. Feature flags via PostHog for experiment gating (#126, #127)

## Consequences

### Positive

- One platform, one SDK, one consent toggle — minimal complexity
- 1M events/mo free tier covers early growth
- Product analytics (funnels, retention) enable data-driven onboarding improvements
- Feature flags built-in — useful for experiment gating (Stagehand, Orama)
- Self-hostable if needed later

### Negative

- PostHog's error tracking is less mature than Sentry (acceptable tradeoff — start simple, upgrade if needed)
- Stack trace / source map support not as deep as Sentry (mitigated: most errors are in JS/TS where PostHog is adequate)
