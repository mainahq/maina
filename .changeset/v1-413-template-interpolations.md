---
"@mainahq/core": patch
---

The verify line lexer now models template literal interpolations. Text inside a `${…}` is read as code, so a string or template nested in it (`${"`"}`, `${render(`…`)}`) opens and closes on its own and the outer template resumes at the `}` that ends it. Before, a backtick inside an interpolation flipped the lexer out of the template: `slop/hallucinated-import` then flagged fixture source held in template literals (for example a test-support module exporting in-memory repo files) and could miss a real import further down. A `require("…")` written inside an interpolation is real code and is now checked, and `no-any-type` sees `any` inside an interpolation too.
