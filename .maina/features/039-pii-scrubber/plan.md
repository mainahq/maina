# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/telemetry/scrubber.ts`. Pure functions with regex-based pattern matching. No external dependencies.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/telemetry/scrubber.ts` | PII scrubbing functions | New |
| `packages/core/src/telemetry/__tests__/scrubber.test.ts` | Adversarial tests | New |

## Tasks

- [x] T1: Implement `scrubFilePaths()` — absolute paths → repo-relative
- [x] T2: Implement `scrubSecrets()` — API keys, tokens, passwords
- [x] T3: Implement `scrubPersonalInfo()` — emails, IPs, usernames
- [x] T4: Implement `scrubCodeContent()` — code snippets in stack frames
- [x] T5: Implement `scrubPii()` — combined scrubber
- [x] T6: Write 20+ adversarial tests
