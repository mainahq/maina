# Feature: Implementation Plan

## Scope

### In Scope - Cloud error event builder extending OSS reporter - Opt-out check from cloud user settings - Cloud-specific metadata (user_id, org_id, plan_tier) ### Out of Scope - Dashboard UI for error history (maina-cloud repo) - GDPR purge endpoint (maina-cloud repo) - PostHog SDK integration (future)

## Tasks

Progress: 6/6 (100%)

- [x] T1: Write TDD test stubs (18 red confirmed)
- [x] T2: Implement `CloudErrorContext` type with user_id, org_id, plan_tier
- [x] T3: Implement `buildCloudErrorEvent()` extending base event (PII scrubbed)
- [x] T4: Implement `isCloudReportingEnabled()` — default true, opt-out
- [x] T5: Implement `reportCloudError()` — consent-gated with Result (10 tests green)
- [x] T6: Also fixed scrubStackTrace to scrub emails/secrets in stack lines

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
