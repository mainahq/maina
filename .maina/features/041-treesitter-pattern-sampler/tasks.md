# Task Breakdown

## Tasks

- [x] T1: Write TDD test stubs from spec (25 red, confirmed failing)
- [x] T2: Implement `sampleFiles()` — deterministic file sampling
- [x] T3: Implement `detectAsyncStyle()` — async/await vs .then
- [x] T4: Implement `detectFunctionStyle()` — arrow vs declaration
- [x] T5: Implement `detectImportStyle()` — named vs default
- [x] T6: Implement `detectErrorHandling()` — try/catch vs .catch
- [x] T7: Implement `samplePatterns()` — combined runner (17 tests green)
- [x] T8: `maina verify` + `maina review` (READY) + `maina analyze` — all pass

## Dependencies

- Reuses `ConstitutionRule` type from `packages/core/src/constitution/git-analyzer.ts`

## Definition of Done

- [ ] All tests pass (red → green confirmed)
- [ ] Biome lint clean + TypeScript compiles
- [ ] maina verify + slop + review + analyze pass
- [ ] Runs in <10s on maina repo
