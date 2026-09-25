---
"@mainahq/core": minor
---

New code-graph queries over the incremental store. `codeGraphImpact(ports, { files, symbols, depth })` walks callers, references, inheritance and imports back from the targets for up to `depth` hops (default 3) and returns the transitive callers (nearest first), the dependent files, the tests covering the targets and every caller in range, and a `blastScore` (the share of the repo's other non-test files that depend on the change). `codeGraphMinimalContext(ports, root, { files | query, budgetTokens, depth })` returns line-exact snippets of the targets, then what they call, then what calls them, never exceeding the token budget, and reports `savedTokens` against reading every touched file in full; files edited since indexing are listed as stale instead of sliced at the wrong lines. `searchCodeGraph(ports, query, { limit, includeTests })` ranks symbols, tests and files by name, qualified name and path.
