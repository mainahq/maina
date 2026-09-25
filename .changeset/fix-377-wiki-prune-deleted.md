---
"@mainahq/core": patch
---

`maina wiki compile` now prunes articles for deleted source files. After writing the new article set, the compiler removes any page in its own subdirectories (`modules/`, `entities/`, `features/`, `decisions/`, `architecture/`) that this compile did not produce, and it rebuilds the `.state.json` article hashes from the current set. Removed APIs therefore no longer show up in wiki search, query or `getContext`. User notes in `wiki/raw/` are never touched. Pruning fails closed: sampled compiles (`maina setup`), compiles where a source file exists but cannot be read, and compiles where an existing `adr/` directory cannot be read all skip it, because their article set is not authoritative. Only flat pages in the compiler-owned subdirectories are ever candidates, so a malformed `.state.json` key cannot reach outside the wiki.
