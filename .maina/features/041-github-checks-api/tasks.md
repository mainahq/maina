# Task Breakdown

## Tasks

- [x] T1: Write TDD test stubs from spec criteria (16 tests, red phase confirmed)
- [x] T2: Implement `formatAnnotations()` — Finding[] → GitHub annotation format
- [x] T3: Implement `determineConclusion()` — findings → success/failure/neutral
- [x] T4: Implement `createCheckRun()` — POST to GitHub Checks API
- [x] T5: Run `maina verify` + `maina review` + `maina analyze`

## Dependencies

- Depends on `Finding` type from `packages/core/src/verify/diff-filter.ts`
- Depends on `Result` type from `packages/core/src/db/index.ts`
- Same auth pattern as `packages/core/src/github/sticky-comment.ts`

## Definition of Done

- [x] All 16 tests pass (green phase)
- [x] Biome lint clean
- [x] TypeScript compiles
- [x] maina verify passes
- [x] maina slop clean
- [x] maina review: READY verdict
