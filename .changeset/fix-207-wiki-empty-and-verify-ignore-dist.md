---
"@mainahq/cli": patch
"@mainahq/core": patch
"@mainahq/mcp": patch
"@mainahq/skills": patch
---

fix(core,verify,wiki): exclude bundled artifacts from verify and index tiny repos in wiki init (#207)

- **verify**: `maina verify` now skips files inside `dist/`, `build/`, `out/`,
  `node_modules/`, `coverage/`, `target/`, `vendor/` and friends, plus files
  matching common bundler suffixes (`*.min.js`, `*.bundle.js`, `*-bundle.js`,
  `*.chunk.js`, `*.d.ts`, `*.map`). Previously, on a GitHub-Action repo whose
  ncc-bundled `dist/index.js` was committed, the first `maina verify` produced
  ~10k slop findings. Honors a `.maina/ignore` file (gitignore-style) for
  project-local extras.
- **wiki**: `maina wiki init` on a single-file repo no longer reports `0
  articles`. When no entity/architecture article matched, the compiler now
  emits a `wiki/architecture/source-tree.md` fallback that at least lists
  every source file. `state.fileHashes` is also written on small sample-mode
  compiles (no truncation) so `wiki status` shows an honest coverage number
  instead of 0%.
