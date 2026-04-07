# Architecture: Monorepo Structure

> Auto-generated architecture article describing the monorepo layout.

Maina is organized as a monorepo under `packages/`.

## Packages

### cli

- **Path:** `packages/cli/`
- **Description:** Commander entrypoint, commands (thin wrappers over engines), terminal UI
- **Modules:** __tests__, commands

### core

- **Path:** `packages/core/`
- **Description:** Three engines + cache + AI + git + DB + hooks
- **Modules:** ai, benchmark, cache, cloud, config, context, db, design, explain, features, feedback, git, hooks, init, language, prompts, review, stats, ticket, verify, wiki, workflow

### docs

- **Path:** `packages/docs/`
- **Description:** Documentation site
- **Modules:** assets, components, content, pages, styles

### mcp

- **Path:** `packages/mcp/`
- **Description:** MCP server (delegates to engines)
- **Modules:** __tests__, tools

### skills

- **Path:** `packages/skills/`
- **Description:** Cross-platform skills (Claude Code, Cursor, Codex, Gemini CLI)
