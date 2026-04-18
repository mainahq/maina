---
"@mainahq/cli": minor
"@mainahq/core": minor
---

feat(verify): add doc-claims tool that catches fabricated API signatures in markdown

New built-in verify tool that runs on changed `.md` / `.mdx` files. It parses
fenced code blocks for `import` / `require` statements, resolves the module to
the corresponding workspace package source, and emits a warning when a claimed
symbol is not actually exported.

Motivated by issue #180: a subagent asked to summarize a package's public API
returned a narrative that mixed real exports with plausible-looking
fabrications, and the fabrications shipped to docs (workkit#43, 20+ wrong API
claims caught only by Copilot post-merge). This gate catches that class of
slop before the docs ever land.

v1 is mechanical (no LLM), diff-only, and intentionally scoped: external
packages are skipped (no `node_modules` walk), member-access claims are not
validated (requires type info), and `export *` re-exports are treated as
wildcards. Severity is `warning` so users can tune via the noisy-rules
preference before promoting to `error` in their constitution.
