---
name: onboarding
description: First-time maina setup and configuration in any AI coding tool.
triggers:
  - "setup"
  - "configure"
  - "onboard"
  - "first time"
  - "getting started"
---

> This plugin bundles the maina CLI: run it as `../../launcher/launch.sh cli <command>`, a path relative to this skill's folder.

# Onboarding

## When to use

When setting up maina for the first time in a repository, configuring it for a new AI coding tool, or onboarding a new team member. This skill covers initial setup, tool discovery, and per-tool configuration.

## Steps

1. **Onboard maina** with `../../launcher/launch.sh cli setup`. This detects your project stack, writes `.maina/` and a constitution, and adds maina's managed region to agent files and its `mcpServers.maina` key to MCP configs. It is safe to re-run: it never overwrites your files and backs up originals to `.maina/backups/`. (`../../launcher/launch.sh cli init` is a deprecated alias.)
2. **Opt into older agent files** with `../../launcher/launch.sh cli setup --legacy-agents` if you use Cline, Roo Code, Continue.dev, Amazon Q, Aider or Gemini CLI rule files.
3. **Verify the installation** with `../../launcher/launch.sh cli doctor`. This checks that the CLI, MCP server, AI provider, and verification tools are all working.
4. **Compile codebase knowledge** with `../../launcher/launch.sh cli wiki init`. This scans your codebase, extracts entities via tree-sitter, and generates initial wiki articles.
5. **Review available MCP tools** -- once configured, your AI coding tool can call these MCP tools directly:

<!-- maina:mcp-tools default table -->
| Tool | When to use |
|------|-------------|
| `verify` | Run the verification pipeline on your changes before asking for review; fix findings on changed lines. |
| `decide` | Ask the repo's policy typed questions (e.g. `finding.real`, `diff.needs_review`) instead of guessing. |
| `impact` | Before changing files or symbols, see what they can affect: callers, dependent files, covering tests. |
| `context` | Get the source you need for files or a query, within a token budget, before reading whole files. |
| `review_triage` | Two-stage review of your diff (spec compliance, then code quality), triaged into blocking, advisory and info. |
| `spec_check` | Check a feature's spec.md, plan.md and tasks.md agree before implementing it. |
| `receipt` | Verify maina receipt JSON files against the v1 schema and their canonical hash. |
| `status` | Check the maina version, the enabled tools, and whether the code graph, wiki and policy are ready. |
<!-- /maina:mcp-tools -->

The DeepWiki-compatible wiki tools (`ask_question`, `read_wiki_structure`, `read_wiki_contents`) are off by default; enable them with `--tools default,ask_question,read_wiki_structure,read_wiki_contents` or `MAINA_MCP_TOOLS`.

6. **Follow the standard workflow** for development:

```
brainstorm -> ticket -> plan -> design -> spec -> implement
                                                      |
                              pr <- commit <- review <- verify
                              |
                            merge -> learn -> improve
```

## Per-Tool Setup

### Claude Code
MCP auto-configured via `.mcp.json` (Claude Code never reads MCP servers from `settings.json`). Run `../../launcher/launch.sh cli setup` and it is ready.

### Cursor
MCP via `.cursor/mcp.json` or project-level `.mcp.json`. Rules loaded from `.cursor/rules/maina.mdc`. Run `../../launcher/launch.sh cli setup`.

### Windsurf
Rules loaded from `.windsurf/rules/maina.md`. MCP requires global configuration: run `../../launcher/launch.sh cli setup` to write it.

### Continue.dev
MCP auto-discovered from `.continue/mcpServers/maina.json`. Run `../../launcher/launch.sh cli setup --legacy-agents`.

### Cline
Rules loaded from `.clinerules` (`../../launcher/launch.sh cli setup --legacy-agents`). MCP configured via VS Code settings: run `../../launcher/launch.sh cli mcp add`.

### Roo Code
MCP via `.roo/mcp.json`. Rules loaded from `.roo/rules/maina.md`. Run `../../launcher/launch.sh cli setup --legacy-agents`.

### GitHub Copilot
MCP via `.vscode/mcp.json`. Instructions loaded from `.github/copilot-instructions.md`. Run `../../launcher/launch.sh cli setup`.

### Amazon Q
MCP via `.amazonq/mcp.json`. Run `../../launcher/launch.sh cli setup --legacy-agents`.

### Zed
MCP via global `~/.config/zed/settings.json`. Run `../../launcher/launch.sh cli setup` to write the config.

### Aider
No MCP support. Uses `CONVENTIONS.md` and `.aider.conf.yml` for context. Run `../../launcher/launch.sh cli setup --legacy-agents`.

### Gemini CLI
MCP via `.mcp.json`. Instructions loaded from `GEMINI.md`. Run `../../launcher/launch.sh cli setup --legacy-agents`.

### Codex CLI
Instructions loaded from `AGENTS.md`. Run `../../launcher/launch.sh cli setup`.

## Example

```bash
# First-time setup
../../launcher/launch.sh cli setup
# Detected: TypeScript, bun, biome
# Created .maina/ configuration
# Wrote constitution to .maina/constitution.md
# Configured MCP for Claude Code, Cursor, Copilot

../../launcher/launch.sh cli doctor
# CLI:        OK  v1.1.0
# MCP:        OK  10 tools registered
# AI:         OK  OpenRouter (standard: claude-sonnet-4)
# Verify:     OK  Biome, Semgrep, Trivy detected
# Wiki:       WARN  Not initialized (run ../../launcher/launch.sh cli wiki init)

../../launcher/launch.sh cli wiki init
# Scanned 142 files, extracted 891 entities
# Generated 48 wiki articles
# Wiki ready at .maina/wiki/
```

## Notes

- All commands work as both CLI (`../../launcher/launch.sh cli <command>`) and MCP tools inside AI coding tools.
- MCP configuration is merged automatically by `../../launcher/launch.sh cli setup` for tools that support project-level config files.
- For tools that require global config (Windsurf, Zed), use `../../launcher/launch.sh cli mcp add`.
- Run `../../launcher/launch.sh cli doctor` at any time to verify your setup is healthy.
