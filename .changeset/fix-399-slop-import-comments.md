---
"@mainahq/core": patch
---

The slop detector's `slop/hallucinated-import` rule no longer reads import-like text inside comments or string literals as an import. A JSDoc line such as ``/** Side-effect import (`import "./polyfill"`) */`` used to raise an error-severity finding that blocked `maina commit`. Each line is now lexed first: `//` and `/* … */` comments (including multi-line JSDoc bodies) are blanked, string, template-literal and regex-literal contents are masked (template literals spanning lines too), and `import … from` / side-effect `import` must sit at statement position. `require(` still matches anywhere in code. Re-exports (`export … from "./x"`) that point at missing files are now flagged as well.
