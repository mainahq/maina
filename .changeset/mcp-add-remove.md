---
"@mainahq/cli": minor
"@mainahq/core": minor
---

feat(cli): `maina mcp add/remove/list` across 8 AI clients

Adds three new top-level commands inspired by `npx @posthog/wizard mcp add`:

- `maina mcp add` — install the maina MCP server in every detected client's global config
- `maina mcp remove` — strip the maina entry from every client
- `maina mcp list` — show install status per client

Supported clients: **Claude Code, Cursor, Windsurf, Cline, OpenAI Codex CLI, Continue.dev, Gemini CLI, Zed**. Each client's config — JSON for seven of them, TOML for Codex — is parsed, mutated only at the maina entry, and atomically rewritten so all other MCP servers and unrelated config keys are preserved.

Flags (all subcommands): `--client <list>` (comma-separated; default: auto-detect), `--scope global|project|both` (default: `global`), `--dry-run`, `--json`.

This is the cross-project counterpart to the setup wizard's per-project install — `maina setup` continues to write `.mcp.json` and `.claude/settings.json` for the current repo, while `maina mcp add` reaches every project at once.

The Continue.dev integration uses the legacy `~/.continue/config.json#experimental.modelContextProtocolServers` shape; the newer per-server YAML files at `~/.continue/.continue/mcpServers/*.yaml` will land when YAML support is added (tracked as a follow-up).
