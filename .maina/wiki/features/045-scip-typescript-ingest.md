# Feature: Implementation Plan

## Scope

### In Scope - Subprocess invocation of scip-typescript - Output parsing (SCIP protobuf → internal types) - Monorepo support (find all tsconfig.json) - Availability check + graceful fallback ### Out of Scope - Wiki article generation from SCIP data (uses existing symbol-page.ts) - Installing scip-typescript (user responsibility or maina doctor recommendation)

## Tasks

Progress: 6/6 (100%)

- [x] T1: Write TDD test stubs (19 red confirmed)
- [x] T2: Implement `isScipAvailable()` — PATH check
- [x] T3: Implement `findTsConfigs()` — monorepo glob with depth limit
- [x] T4: Implement `runScipTypescript()` — spawn + parse
- [x] T5: Implement `parseScipOutput()` — JSON → ScipSymbol[] (11 tests green)
- [x] T6: maina verify + review

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
