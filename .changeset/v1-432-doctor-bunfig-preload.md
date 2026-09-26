---
"@mainahq/cli": patch
---

`maina doctor` no longer runs a repo's `bunfig.toml` preload when it launches a configured MCP entry on its own. Bun reads `bunfig.toml` from its cwd, so launching a trusted project entry (`bun <entry> --mcp`, the `maina` shim, `bunx`) or a user-scope entry in the repo ran repo code first. Those launches now start in a fresh empty directory outside the repo; only an entry launched because of `--launch-project` still starts in the repo, as its host would.
