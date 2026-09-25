---
"@mainahq/core": patch
---

`maina verify` no longer reports inline type imports (`import { A, type B } from "…"`) as unused; the built-in unused-import check now strips the `type` modifier before looking for usages.
