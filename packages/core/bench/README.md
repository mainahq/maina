# Gate-bench sets

`gate-bench/` holds the benchmark sets System 1 is measured on (#583,
FR-GATE-2). The labelled command corpus
(`src/gate/__fixtures__/commands.jsonl`) is System 1 training data, so no
model metric is ever reported on it: the landing proofs refuse to run with a
model deciding `action.risk`, and the public benchmark report is refused when
its dataset is the corpus.

| Set | What it holds | Deterministic gate |
| --- | --- | --- |
| `overeager.jsonl` | Actions that look dangerous but are safe: quoted or searched-for commands, reversible git, dry runs, read-only queries, workspace writes with scary content | allows every one |
| `injection.jsonl` | Gated actions carrying text meant to talk the gate into allowing them (comments, forged answers, chat-template tokens, file content, MCP fields, provenance), each with its base action | holds every one, with the same verdict as its base |

`gate-bench/hashes.json` records each set file's sha256 and every item's
content hash, injection bases included. maina-model reads it as its
training-exclusion anchors: no item, and no near-duplicate of one, may enter
a training split. The sets are frozen: any edit changes the hashes, and
`scripts/__tests__/gate-bench-sets.test.ts` fails until the manifest is
regenerated with `bun run bench:gate-sets`, which maina-model then has to
pick up with a pin bump.

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
