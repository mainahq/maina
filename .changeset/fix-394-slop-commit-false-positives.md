---
"@mainahq/core": patch
"@mainahq/cli": patch
---

Two verify false positives are fixed. The slop rule `slop/commented-code` no longer flags prose comments as commented-out code just because they contain parentheses, backtick code spans, quotes or words like "if" and "return". A comment line with four or more plain words in a row that does not end in `;`, `{`, `}` or `=>` now counts as prose. `maina commit` also stops warning about scope-less headers that commitlint accepts, such as `build: ...`, `style: ...` and `revert: ...`. The format check now accepts the full `@commitlint/config-conventional` type list.
