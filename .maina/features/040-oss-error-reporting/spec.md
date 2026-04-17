# Feature: OSS error reporting — opt-in, aggressive scrubbing

## Problem Statement

Without error reporting, bugs ship blind. Users hit crashes, file vague issues, maintainers can't reproduce. The PII scrubber (#120) and PostHog ADR (#89) are done — now wire them together.

## Success Criteria

- [x] `reportError(error, context)` function that scrubs + sends to PostHog
- [x] Consent check: zero events sent until explicit opt-in
- [x] `isErrorReportingEnabled()` reads from config
- [x] Error events include: error class, scrubbed message, Maina version, OS, command
- [x] Unit tests for consent gating, event formatting, scrubbing integration

## Scope

### In Scope
- `packages/core/src/telemetry/reporter.ts` — error reporting with PostHog
- Consent check from `~/.maina/config.yml`
- Integration with PII scrubber

### Out of Scope
- Consent prompt UI (CLI command, separate issue)
- `maina errors status/off` commands (separate issue)
- Cloud error reporting (separate issue #122)
