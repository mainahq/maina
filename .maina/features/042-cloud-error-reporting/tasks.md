# Task Breakdown

## Tasks

- [x] T1: Write TDD test stubs (18 red confirmed)
- [x] T2: Implement `CloudErrorContext` type with user_id, org_id, plan_tier
- [x] T3: Implement `buildCloudErrorEvent()` extending base event (PII scrubbed)
- [x] T4: Implement `isCloudReportingEnabled()` — default true, opt-out
- [x] T5: Implement `reportCloudError()` — consent-gated with Result (10 tests green)
- [x] T6: Also fixed scrubStackTrace to scrub emails/secrets in stack lines

## Dependencies

- Extends `buildErrorEvent()` from `packages/core/src/telemetry/reporter.ts`

## Definition of Done

- [ ] All tests pass (red → green)
- [ ] Biome lint + TypeScript clean
- [ ] maina verify + slop + review + analyze pass
- [ ] Events never include email or name
