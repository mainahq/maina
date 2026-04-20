# Feature: Swap Louvain for Leiden in wiki community detection

> Tracking issue: [#199](https://github.com/mainahq/maina/issues/199)

## Problem

`packages/core/src/wiki/louvain.ts` runs Louvain for module-article boundaries. Louvain can produce disconnected communities and is sensitive to node ordering, which leads to unstable/weird module groupings on re-compiles. Leiden (Traag et al., 2019) fixes both: it guarantees connected communities and produces higher modularity with the same input.

## Why it matters

Module articles are the first thing a reader sees when they open the wiki. Poor clustering = wrong mental model of the codebase. Users have already flagged 'this grouping looks random' on dogfood runs.

## Success criteria

- [ ] Leiden implementation available at `packages/core/src/wiki/communities.ts` (rename from `louvain.ts`, keep Louvain as a fallback codepath).
- [ ] New option: `compile({ communityAlgorithm: 'leiden' | 'louvain' })`, default `'leiden'`.
- [ ] On maina's own repo, Leiden produces measurably higher modularity score than Louvain (assert in a test).
- [ ] All existing Louvain tests still pass against the Louvain codepath.
- [ ] Leiden output is deterministic for a fixed seed.
- [ ] No disconnected communities are ever returned (invariant-asserted in a test).
- [ ] `maina verify` passes.

## Scope

### In Scope
- Leiden implementation (port from a trusted reference or bring in `graphology-communities-leiden` if license-compatible).
- Flag plumbing through compiler + CLI.
- Community-naming logic in `compiler.ts::deriveCommunityName` kept unchanged.

### Out of Scope
- Any change to PageRank, Ebbinghaus decay, or article templates.
- UI/visualization (tracked separately as 047).

## Notes

- If we take a dependency, confirm it's MIT/Apache-2 and <50KB minified.
- Add a microbenchmark in `__tests__/communities.bench.ts`.
