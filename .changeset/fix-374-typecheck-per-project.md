---
"@mainahq/core": patch
---

verify: built-in typecheck runs `tsc -p` per nearest tsconfig of the changed files instead of one root `tsc`, so workspace packages' own types and dependencies resolve (no more false TS2307/TS2868 on new package files).
