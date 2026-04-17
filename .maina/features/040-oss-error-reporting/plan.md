# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/telemetry/reporter.ts`. Uses the PII scrubber from `scrubber.ts` and formats events for PostHog. No actual PostHog SDK dependency yet — events are formatted as plain objects that a future PostHog client will send.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/telemetry/reporter.ts` | Error reporting with consent gating | New |
| `packages/core/src/telemetry/__tests__/reporter.test.ts` | Tests | New |

## Tasks

- [x] T1: Implement `isErrorReportingEnabled()` — reads config
- [x] T2: Implement `buildErrorEvent()` — formats error with context + scrubbing
- [x] T3: Implement `reportError()` — consent check + scrub + format
- [x] T4: Write tests for consent gating, event building, scrubbing
