# Feature: Emit self-contained wiki/graph.html after compile

> Tracking issue: [#200](https://github.com/mainahq/maina/issues/200)

## Problem

The wiki's knowledge graph is currently only accessible through markdown articles and the MCP `read_wiki_structure` tool. There is no way to visually explore the graph, spot clusters, or follow PageRank gradients. Competitors (Graphify, DeepWiki) lead with visualization; we lead with semantics but hide them.

## Why it matters

- Visualization is the demo. Screenshots of `graph.html` are what gets shared on X.
- Visual exploration surfaces graph-quality bugs (dangling nodes, over-merged communities) that are invisible in markdown output.
- It is the natural landing surface for a future hosted maina-cloud graph explorer.

## Success criteria

- [ ] `packages/core/src/wiki/visualize.ts` exports `renderGraphHtml(graph, articles, options): string`.
- [ ] `compile()` writes `wiki/graph.html` alongside articles unless `dryRun` or `--no-viz`.
- [ ] HTML is self-contained: no network requests at view-time, no build step.
- [ ] Features: force-directed layout, node coloring by type (entity/module/feature/decision), size by PageRank, search by name, filter checkbox per node type, click-to-open article (relative link to the `.md`).
- [ ] Total file size < 300KB for a 500-node graph.
- [ ] Deterministic layout when given a fixed seed (reproducible for snapshot tests).
- [ ] Works on Chrome, Firefox, Safari latest. No framework; vanilla + a single embedded force-layout implementation.

## Scope

### In Scope
- New file `visualize.ts` + tests.
- Integration into `compiler.ts`.
- One golden-file test that compiles on a fixture repo and snapshots the HTML.

### Out of Scope
- Live-reloading dev mode (tracked separately if requested).
- 3D layouts.
- Any server component.

## Notes

- Prefer inlining d3-force (not the full d3) or a small handwritten Barnes–Hut impl to keep bundle tight.
- Must degrade gracefully: if `graph.nodes` is empty, emit an empty-state page, not a crash.
