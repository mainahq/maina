---
"@mainahq/core": patch
---

The gate now classes two more CLI commands as `gate.self_override` when an agent runs them, because they write Codex's `config.toml` (a gate control file) from inside the CLI, where the gate cannot see the write:

- `maina mcp add` and `maina mcp remove`, unless the command cannot reach Codex's config: a `--dry-run`, `--scope project` (Codex has no project file), or a `--client` list without `codex`. With no `--client` the CLI auto-detects clients, so the gate treats the command as a write. An empty or unreadable `--client` or `--scope` value is treated the same way. Options are read the way Commander reads them, so `--client --dry-run` sets the client and does not turn on a dry run. Any word the gate cannot read (`"$F"`) could be `--client=codex`, `--scope=global` or `--`, so it counts as a write, and a `--dry-run` or `--help` after it does not count.
- `maina doctor --fix`, which runs `maina mcp add` for missing or broken host entries. `maina doctor "$F"` counts too, because `"$F"` could be `--fix`.

`maina mcp list`, `maina doctor` without `--fix`, and `--help` still pass.
