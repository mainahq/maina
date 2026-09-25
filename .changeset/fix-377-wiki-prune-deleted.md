---
"@mainahq/core": patch
---

`maina wiki compile` now prunes articles for deleted source files. After writing the new article set, the compiler removes any page in its own subdirectories (`modules/`, `entities/`, `features/`, `decisions/`, `architecture/`) that this compile did not produce, and it rebuilds the `.state.json` article hashes from the current set. Removed APIs therefore no longer show up in wiki search, query or `getContext`. User notes in `wiki/raw/` are never touched. Sampled compiles (`maina setup`) skip pruning because they see only part of the repo.
