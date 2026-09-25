---
"@mainahq/core": minor
"@mainahq/cli": minor
"@mainahq/mcp": minor
---

`maina verify` now checks the whole working tree by default: staged, unstaged and untracked changes against the base branch, so an unsaved-to-index edit with a finding is reported instead of passing silently. `--staged` keeps the old staged-only scope. Findings in untracked files are no longer hidden as pre-existing by the diff-only filter.

Results are honest: `PipelineResult` gains `status: "passed" | "failed" | "skipped"` and `scope: { kind, files }`. A run is `passed` only when no error findings remain and at least one tool actually ran on a file in scope; an empty scope (or one no tool could check) is `skipped`, never `passed`, and `passed` is `false` for it. The CLI prints the scope, exits 0 on a skip without claiming a pass, and `maina commit` warns on a skip instead of blocking. The JSON output (`--json`, MCP `verify`) includes `status` and `scope`.
