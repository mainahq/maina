---
"@mainahq/core": patch
---

The built-in `no-any-type` check no longer flags identifiers that end in `any` when they are followed by punctuation, such as `many)`, `company,` or `Array<Company>`. Standalone `any` in positions like `Map<string, any>`, `string | any` and `any[]` is still reported.
