---
"@mainahq/core": minor
---

New incremental code-graph store: `indexRepo(ports, root)` indexes every file a grammar reads (as git lists them, or by walking the tree outside a repository) and `updateFiles(ports, root, paths)` brings just the given paths up to date. The store lives in SQLite behind `DbPort` (tables created by a versioned migration) and keeps file, symbol and test nodes plus `imports`, `calls`, `references` and `inherits` edges resolved across files for all five languages. Files are keyed by content hash: an unchanged file is never parsed again, and a rename or revert reuses the stored parse. After a change, only the changed files and the files whose resolution looked at them are re-resolved, and the result equals a full rebuild. `readCodeGraph(db)` returns the stored graph.
