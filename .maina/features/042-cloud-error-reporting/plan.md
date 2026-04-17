# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/telemetry/cloud-reporter.ts`. Extends the OSS reporter with cloud-specific metadata. Uses `Result<T, E>` pattern.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/telemetry/cloud-reporter.ts` | Cloud error reporting | New |
| `packages/core/src/telemetry/__tests__/cloud-reporter.test.ts` | TDD tests | New |

## Tasks

- [ ] T1: Write TDD test stubs (red phase)
- [ ] T2: Implement `CloudErrorContext` type with user_id, org_id, plan_tier
- [ ] T3: Implement `buildCloudErrorEvent()` extending base event
- [ ] T4: Implement `isCloudReportingEnabled()` — default true, respects opt-out
- [ ] T5: Implement `reportCloudError()` — consent-gated
- [ ] T6: `maina verify` + `maina review` + `maina analyze`
