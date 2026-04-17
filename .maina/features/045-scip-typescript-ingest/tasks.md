# Task Breakdown

## Tasks

- [x] T1: Write TDD test stubs (19 red confirmed)
- [x] T2: Implement `isScipAvailable()` — PATH check
- [x] T3: Implement `findTsConfigs()` — monorepo glob with depth limit
- [x] T4: Implement `runScipTypescript()` — spawn + parse
- [x] T5: Implement `parseScipOutput()` — JSON → ScipSymbol[] (11 tests green)
- [x] T6: maina verify + review

## Dependencies

- scip-typescript must be installed for integration tests (unit tests use mocks)

## Definition of Done

- [ ] All tests pass (red → green)
- [ ] Graceful fallback when scip-typescript not installed
- [ ] maina verify + slop + review pass
