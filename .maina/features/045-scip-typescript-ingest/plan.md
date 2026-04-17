# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/wiki/scip-ingest.ts`. Spawns `scip-typescript` via `Bun.spawn`, parses the JSON index output, normalizes into internal `ScipSymbol` type compatible with `CodeEntity`.

## Key Technical Decisions

- Use `scip-typescript --output json` for parseable output (avoid protobuf dependency)
- Find tsconfig.json files via glob for monorepo support
- Graceful fallback: check `which scip-typescript` before spawning
- Result<T, E> pattern for all operations

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/wiki/scip-ingest.ts` | SCIP runner + parser | New |
| `packages/core/src/wiki/__tests__/scip-ingest.test.ts` | TDD tests | New |

## Tasks

- [ ] T1: Write TDD test stubs (red phase)
- [ ] T2: Implement `isScipAvailable()` — check PATH
- [ ] T3: Implement `findTsConfigs()` — glob for tsconfig.json in monorepo
- [ ] T4: Implement `runScipTypescript()` — spawn + parse output
- [ ] T5: Implement `parseScipOutput()` — JSON → ScipSymbol[]
- [ ] T6: maina verify + review + analyze
