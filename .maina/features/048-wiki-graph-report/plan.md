# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- Pure function `generateGraphReport(articles, graph, state): string`, invoked in `compiler.ts` after linking and before state save.
- [NEEDS CLARIFICATION] JSON companion (`wiki/.graph-report.json`) shape — flat arrays per section or a single object keyed by section.
- [NEEDS CLARIFICATION] Truncation thresholds for the 'and N more' tails per section.

## Files

| File | Purpose | New/Modified |
|------|---------|--------------|
| `packages/core/src/wiki/report.ts` | `generateGraphReport()` | New |
| `packages/core/src/wiki/__tests__/report.test.ts` | Snapshot + size bound + determinism | New |
| `packages/core/src/wiki/compiler.ts` | Emit report after linker, before state save | Modified |

## Tasks

See `tasks.md`.
