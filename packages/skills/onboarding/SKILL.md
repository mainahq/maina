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

# Onboarding

## When to use

When setting up maina for the first time in a repository, configuring it for a new AI coding tool, or onboarding a new team member. This skill covers initial setup, tool discovery, and per-tool configuration.

## Steps

1. **Bootstrap maina** with `maina init` (or `npx @mainahq/cli init`). This creates `.maina/` config, detects your project stack, and writes a constitution file.
2. **Run guided configuration** with `maina setup`. This walks through model selection, API keys, and tool-specific MCP configuration.
3. **Verify the installation** with `maina doctor`. This checks that the CLI, MCP server, AI provider, and verification tools are all working.
4. **Compile codebase knowledge** with `maina wiki init`. This scans your codebase, extracts entities via tree-sitter, and generates initial wiki articles.
5. **Review available MCP tools** -- once configured, your AI coding tool can call these MCP tools directly:

| MCP Tool | Description |
|----------|-------------|
| `getContext` | 4-layer context retrieval with dynamic token budget |
| `getConventions` | Project conventions and constitution |
| `verify` | Full verification pipeline on staged changes |
| `checkSlop` | Detect AI-generated filler text and placeholders |
| `reviewCode` | Two-stage AI code review (spec + quality) |
| `explainModule` | Explain a module's purpose, exports, and dependencies |
| `suggestTests` | Generate test stubs from feature plans |
| `analyzeFeature` | Validate spec-plan consistency |
| `wikiQuery` | Search and synthesize answers from wiki articles |
| `wikiStatus` | Wiki health dashboard |

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
MCP auto-configured via `.claude/settings.json`. Run `maina init` and it is ready.

### Cursor
MCP via `.cursor/mcp.json` or project-level `.mcp.json`. Rules loaded from `.cursorrules`. Run `maina init`.

### Windsurf
Rules loaded from `.windsurfrules`. MCP requires global configuration: run `maina setup` to write it.

### Continue.dev
MCP auto-discovered from `.continue/mcpServers/maina.json`. Run `maina init`.

### Cline
Rules loaded from `.clinerules`. MCP configured via VS Code settings: run `maina setup`.

### Roo Code
MCP via `.roo/mcp.json`. Rules loaded from `.roo/rules/maina.md`. Run `maina init`.

### GitHub Copilot
MCP via `.vscode/mcp.json`. Instructions loaded from `.github/copilot-instructions.md`. Run `maina init`.

### Amazon Q
MCP via `.amazonq/mcp.json`. Run `maina init`.

### Zed
MCP via global `~/.config/zed/settings.json`. Run `maina setup` to write the config.

### Aider
No MCP support. Uses `CONVENTIONS.md` and `.aider.conf.yml` for context. Run `maina init`.

### Gemini CLI
MCP via `.mcp.json`. Instructions loaded from `GEMINI.md`. Run `maina init`.

### Codex CLI
Instructions loaded from `AGENTS.md`. Run `maina init`.

## Example

```bash
# First-time setup
npx @mainahq/cli init
# Detected: TypeScript, bun, biome
# Created .maina/ configuration
# Wrote constitution to .maina/constitution.md
# Configured MCP for Claude Code, Cursor, Copilot

maina doctor
# CLI:        OK  v1.1.0
# MCP:        OK  10 tools registered
# AI:         OK  OpenRouter (standard: claude-sonnet-4)
# Verify:     OK  Biome, Semgrep, Trivy detected
# Wiki:       WARN  Not initialized (run maina wiki init)

maina wiki init
# Scanned 142 files, extracted 891 entities
# Generated 48 wiki articles
# Wiki ready at .maina/wiki/
```

## Notes

- All commands work as both CLI (`maina <command>` or `npx @mainahq/cli <command>`) and MCP tools inside AI coding tools.
- MCP configuration is written automatically by `maina init` for tools that support project-level config files.
- For tools that require global config (Windsurf, Zed), use `maina setup` instead.
- Run `maina doctor` at any time to verify your setup is healthy.
