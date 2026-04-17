# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/errors/error-id.ts`. Pure functions, no side effects. ID generated from hash of error class + message, encoded in base32 without ambiguous chars.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/errors/error-id.ts` | ID generation + formatting | New |
| `packages/core/src/errors/__tests__/error-id.test.ts` | Tests | New |
| `packages/core/src/index.ts` | Export new functions | Modified |

## Tasks

- [x] T1: Write tests for ID generation, formatting, ambiguous char exclusion
- [x] T2: Implement `generateErrorId(error)` using DJB2 hash (fast, deterministic, no dependency)
- [x] T3: Implement `formatErrorForCli(error)` and `formatErrorForMcp(error)`
- [x] T4: maina verify + maina slop
