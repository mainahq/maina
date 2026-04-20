# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- [NEEDS CLARIFICATION] Port Leiden ourselves vs. depend on `graphology-communities-leiden`. Decision gate on license + bundle size.
- [NEEDS CLARIFICATION] Public surface of `packages/core/src/wiki/communities.ts` — confirm the signature compile() consumes today.

## Files

| File | Purpose | New/Modified |
|------|---------|--------------|
| `packages/core/src/wiki/communities.ts` | Leiden + Louvain fallback | New (rename from `louvain.ts`) |
| `packages/core/src/wiki/__tests__/communities.test.ts` | Correctness + determinism + connectedness invariant | New |
| `packages/core/src/wiki/__tests__/communities.bench.ts` | Microbenchmark | New |
| `packages/core/src/wiki/compiler.ts` | Plumb `communityAlgorithm` option | Modified |
| `packages/cli/src/commands/wiki/*` | Expose CLI flag | Modified |

## Tasks

See `tasks.md`.
