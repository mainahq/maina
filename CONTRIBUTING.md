# Contributing to Maina

Thank you for your interest in contributing to Maina. This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) (latest stable)
- Git 2.30+

## Dev Setup

```bash
git clone https://github.com/beeeku/maina.git
cd maina
bun install
bun run build
bun run test
```

## Project Structure

Maina is a monorepo with the following packages:

| Package | Purpose |
|---------|---------|
| `packages/cli` | Commander entrypoint, commands, terminal UI |
| `packages/core` | Three engines (Context, Prompt, Verify), cache, AI, git, DB |
| `packages/mcp` | MCP server (delegates to engines) |
| `packages/skills` | Cross-platform skills (Claude Code, Cursor, Codex, Gemini CLI) |
| `packages/docs` | Documentation site |

## Development Workflow

We dogfood Maina throughout development. Use the CLI tools whenever possible:

```bash
maina verify     # Full verification: lint + typecheck + test
maina commit     # AI-assisted conventional commit
maina review     # Code review before PR
```

## Testing

All tests use `bun:test` (not Jest or Vitest).

```bash
bun run test                 # Run all tests
bun test --filter <pattern>  # Run specific tests
```

Write tests first (TDD). Watch them fail, implement, watch them pass.

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) with the following scopes:

- `cli` -- CLI package changes
- `core` -- Core engine changes
- `mcp` -- MCP server changes
- `skills` -- Skills package changes
- `docs` -- Documentation changes
- `ci` -- CI/CD changes

Examples:

```
feat(core): add PageRank scoring to context engine
fix(cli): handle missing config file gracefully
test(core): add verify engine edge cases
```

## Code Style

- **Formatter/Linter:** Biome 2.x (not ESLint or Prettier). Run `bun run check`.
- **Language:** TypeScript in strict mode.
- **Error handling:** Use the `Result<T, E>` pattern. Never throw exceptions.
- **No `console.log`** in production code.
- **Diff-only:** Report findings only on changed lines.

## PR Process

1. Fork the repo and create a feature branch from `master`.
2. Implement your changes with tests.
3. Run `maina verify` (or `bun run verify`) to confirm everything passes.
4. Push your branch and open a pull request.
5. Fill out the PR template.
6. Address review feedback.

## Getting Help

- Open an issue for bugs or feature requests.
- Use the issue templates provided.
