# Code-graph bench

`graph.bench.ts` holds the code graph to the v1 latency budgets
(FR-GRAPH-2, FR-GRAPH-4) on a real ~100k-line repository.

| Measurement | Budget |
| --- | --- |
| Initial index | recorded, no budget |
| Single-file update (`updateFiles`, dependents re-resolved) | <= 500 ms, every sample |
| Warm query (`search`, `impact`, `minimalContext`, each on its own) | <= 200 ms at p95 |

The budgets live in `graph-budget.ts`.

## Running it

```bash
bun run bench:graph                      # fetches the pinned repo on first run
bun run bench:graph --repo <dir>         # any other checkout
bun run bench:graph --json report.json   # also writes the report as JSON
```

The repository is pinned by commit in `scripts/fixtures/fetch-100k-repo.ts`
(colinhacks/zod, MIT, about 100k lines across ~520 files) and cached under
`.cache/bench-repos` (or `$MAINA_BENCH_CACHE`). Moving the pin is a deliberate
change: bump `commit` and re-record the baseline below.

Edits are made through an in-memory overlay on the filesystem port, so the
cached checkout is never modified. The edited files are the four most
depended-on files (every dependent is re-resolved, the worst case) plus eight
spread across the tree; each edit adds an exported function and is then
undone, and both syncs are timed.

## CI

The `graph-bench` job in `.github/workflows/ci.yml` runs beside the main `ci`
job, caches the pinned checkout keyed on the fetch script's hash, fails on any
budget breach, and uploads the JSON report as the `graph-bench-report`
artifact.

## Baseline

Recorded on an Apple M-series laptop, zod@2bf7b06 (523 files, 103,471 lines,
7,137 nodes, 9,015 edges):

| Measurement | p50 | p95 | max |
| --- | --- | --- | --- |
| Initial index | 1.5-1.7 s | | |
| Single-file update | 11 ms | 84 ms | 86 ms |
| Query `search` | 11 ms | 13 ms | 16 ms |
| Query `impact` | 10 ms | 12 ms | 13 ms |
| Query `minimalContext` | 14 ms | 21 ms | 24 ms |
