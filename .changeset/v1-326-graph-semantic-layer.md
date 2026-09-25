---
"@mainahq/core": minor
---

The context engine's semantic layer now reads the code graph instead of regex-parsing imports (FR-GRAPH-5). `context/treesitter.ts` is removed, and the repository is no longer walked on every call. The store under `.maina/graph/` is indexed once, when it is empty, and after that only the staged and recently changed files are synced, by content hash. PageRank runs over the graph's file edges: calls and inheritance weigh 1.0, and import-only or type-only ties weigh 0.5. Re-exports such as `export { x } from "./y"`, which the regex missed, now count as dependencies.

`review` (and any unfiltered command, such as `context`, `explain`, `analyze` and `pr`) now gets a `## Code Graph` section. It holds line-exact snippets of the touched code with its callers and callees, the files that depend on it, the tests covering it, and a blast-radius score, all within half the semantic budget. `assembleContext` accepts optional `graph` ports. `openCodeGraph(mainaDir)` is exported for the runtime's graph hooks, and `indexRepo` records a completed full index in the store's metadata.
