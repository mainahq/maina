# Feature: Implementation Plan

## Scope

### In Scope - `packages/core/src/github/checks.ts` — Check Run creation - Annotation formatting from verify findings - Auth header handling (token vs app) ### Out of Scope - Re-run action button (needs workflow_dispatch, separate issue) - Required-check rule configuration docs (separate) - Actual GitHub Action changes (verify-action repo)

## Tasks

Progress: 5/5 (100%)

- [x] T1: Write TDD test stubs from spec criteria (16 tests, red phase confirmed)
- [x] T2: Implement `formatAnnotations()` — Finding[] → GitHub annotation format
- [x] T3: Implement `determineConclusion()` — findings → success/failure/neutral
- [x] T4: Implement `createCheckRun()` — POST to GitHub Checks API
- [x] T5: Run `maina verify` + `maina review` + `maina analyze`

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
