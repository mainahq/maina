# Feature: Emit wiki/GRAPH_REPORT.md audit on every compile

> Tracking issue: [#201](https://github.com/mainahq/maina/issues/201)

## Problem

After a compile we produce dozens of markdown articles and a state file but no human-readable health summary. Issues like stale articles (Ebbinghaus decay past threshold), dangling `[[wikilinks]]`, orphan entities (zero in-degree and out-degree), and duplicate-named entities are detectable but invisible until a user stumbles on them.

## Why it matters

- A one-page audit is the doc a PR reviewer opens first.
- Makes wiki drift legible. Drift is the #1 reason repo wikis die.
- Feeds directly into the verification-first thesis: we prove the wiki is healthy, we don't just hope.

## Success criteria

- [ ] `packages/core/src/wiki/report.ts` exports `generateGraphReport(articles, graph, state): string`.
- [ ] `compile()` writes `wiki/GRAPH_REPORT.md` alongside articles unless `dryRun`.
- [ ] Report sections (in order): Summary counts (articles by type, nodes, edges, communities); Top 20 entities by PageRank; Top 10 stalest articles by Ebbinghaus score; Orphan entities (nodes with no incident edges); Dangling wikilinks ([[x]] with no target article); Duplicate entity-name disambiguations applied; Time + compile duration.
- [ ] Each row links back to the source article where applicable.
- [ ] Report length < 400 lines for a 500-node graph (truncate lists with 'and N more').
- [ ] Deterministic output for a fixed input (snapshot test).
- [ ] `maina verify` passes.

## Scope

### In Scope
- `report.ts` + tests.
- Integration into `compiler.ts` (after linker, before state save).

### Out of Scope
- HTML version (lives in graph.html, issue 047).
- Any changes to Ebbinghaus scoring or link generation.

## Notes

- Consider emitting a machine-readable companion at `wiki/.graph-report.json` for CI consumption — default on, behind `--no-report-json`.
