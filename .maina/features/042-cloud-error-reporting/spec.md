# Feature: Cloud error reporting — opt-out, account-linked

## Problem Statement

Cloud users need error reporting linked to their account (user_id, org_id, plan_tier) so support can triage. Default-on with opt-out. Extends the OSS reporter (#121) with cloud-specific metadata.

## Target User

- Primary: Maina Cloud support team triaging customer issues
- Secondary: Cloud customers wanting visibility into their error history

## Success Criteria

- [ ] `buildCloudErrorEvent(error, context, cloudContext)` extends base error event with user_id, org_id, plan_tier
- [ ] `isCloudReportingEnabled(cloudContext)` defaults to true, respects opt-out
- [ ] `reportCloudError(error, context, cloudContext)` consent-gated cloud reporter
- [ ] Events never include email or name — only IDs and plan tier
- [ ] Unit tests for cloud metadata, opt-out, PII exclusion

## Scope

### In Scope
- Cloud error event builder extending OSS reporter
- Opt-out check from cloud user settings
- Cloud-specific metadata (user_id, org_id, plan_tier)

### Out of Scope
- Dashboard UI for error history (maina-cloud repo)
- GDPR purge endpoint (maina-cloud repo)
- PostHog SDK integration (future)
