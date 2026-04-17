# 0026. Cloud error reporting with account linking

Date: 2026-04-17

## Status

Accepted

## Context

Cloud users need error reporting linked to their account for support triage. OSS reporter (#121) provides scrubbed error events. Cloud extends this with user_id, org_id, plan_tier — never email or name.

## Decision

Extend the OSS `buildErrorEvent()` with cloud-specific metadata. Default-on for Cloud users, opt-out via user settings. Events tagged with IDs only, never PII.

## Consequences

### Positive
- Support can find errors by user/org in PostHog within 30s
- Plan-tier tagging enables prioritized triage for paid customers

### Negative
- Default-on may concern privacy-conscious users (mitigated: opt-out is immediate, only IDs sent)
