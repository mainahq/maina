# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- [NEEDS CLARIFICATION] Inline d3-force subset vs. handwritten Barnes–Hut. Decision gate on bundled size for a 500-node graph.
- [NEEDS CLARIFICATION] Seeded PRNG used in layout — must be identical across platforms for snapshot stability.

## Files

| File | Purpose | New/Modified |
|------|---------|--------------|
| `packages/core/src/wiki/visualize.ts` | `renderGraphHtml()` — self-contained HTML | New |
| `packages/core/src/wiki/__tests__/visualize.test.ts` | Golden-file snapshot + size bound | New |
| `packages/core/src/wiki/compiler.ts` | Write `wiki/graph.html` unless `dryRun`/`--no-viz` | Modified |

## Tasks

See `tasks.md`.
