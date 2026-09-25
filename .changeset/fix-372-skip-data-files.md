---
"@mainahq/core": patch
---

`maina verify` no longer runs code-pattern checks on data and docs files. The slop detector (including the error-severity `slop/hallucinated-import` rule) and the built-in code-smell checks now run only on source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts`, the language-profile extensions, and `.vue/.svelte/.astro`). Before this, JSON fixtures whose strings held code snippets such as `import x from './missing'` produced false findings that blocked `maina commit`. Data files still get the hardcoded-secret scan.
