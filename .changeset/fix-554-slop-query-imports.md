---
"@mainahq/core": patch
---

`maina verify` no longer reports a bundler query import such as `./table.json?url` or `./icon.svg?raw` as a hallucinated import: the slop check resolves the file without its `?…` or `#…` suffix (#554).
