---
"@mainahq/core": patch
---

The gate now classes writes, moves, links and deletes that land in an installed maina plugin as `gate.self_override`, on Claude Code, Cursor and Codex. Before this, an agent overwriting the plugin's `hooks/hooks.json` (for example `~/.cursor/plugins/local/maina/hooks/hooks.json`) was an ordinary `fs.write.outside` ask, so a user approving it had no sign that it switched the gate off. A move of the plugin folder to `/tmp`, or an MCP `write_file` on its hooks, was not gated at all.

The whole plugin counts, not only its hooks config: its `hooks/hooks.json`, `mcp.json` / `.mcp.json` and manifest, the launcher every hook runs, the runtime in its data dir (`plugins/data/maina-<marketplace>`) and the marketplace copy an update installs from. Removing or replacing what holds the plugin (`~/.claude/plugins`, or its `cache`, `data`, `local` or `marketplaces` dir) counts too. Other plugins, reads of maina's plugin, and maina's plugin sources in a repo are unchanged.
