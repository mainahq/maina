# Copilot Instructions

You are working on a codebase verified by [Maina](https://mainahq.com), the verification-first developer OS. Maina MCP tools are available to you — use them.

## Workflow

When fixing an issue or implementing a feature:

1. **Get context first** — call `maina getContext` with the relevant command type to understand the codebase state
2. **Write tests first** — TDD always. Write failing tests, then implement
3. **Verify your work** — call `maina verify` before requesting review. Fix any findings
4. **Check for slop** — call `maina checkSlop` on files you changed. No empty bodies, no placeholder code, no console.log
5. **Review your code** — call `maina reviewCode` with your diff to catch issues before human review

## Available MCP Tools

| Tool | When to use |
|------|-------------|
| `getContext` | Before starting work — understand branch state, recent changes, verification status |
| `verify` | After making changes — run the full 16-tool verification pipeline |
| `checkSlop` | On changed files — detect AI-generated slop patterns |
| `reviewCode` | On your diff — two-stage review (spec compliance + code quality) |
| `suggestTests` | When implementing features — generate TDD test stubs from plan.md |
| `analyzeFeature` | Check spec/plan/tasks consistency for a feature |
| `getConventions` | Understand project coding conventions |
| `explainModule` | Understand how a module works before modifying it |

## Conventions

- **Runtime:** Bun (NOT Node.js)
- **Language:** TypeScript strict mode
- **Lint/Format:** Biome (NOT ESLint/Prettier)
- **Test:** bun:test (NOT Jest/Vitest)
- **Commits:** Conventional commits with scopes: `cli`, `core`, `mcp`, `skills`, `docs`, `ci`
- **Error handling:** `Result<T, E>` pattern. Never throw
- **No `console.log`** in production code
- **Diff-only:** only report/fix issues on changed lines

## Quality Gates

Your PR will be verified by maina before merge. These must pass:
- Biome lint + format
- TypeScript strict mode compilation
- All tests (run via `bun run test` which uses isolated test runner)
- Slop detection (no AI-generated patterns)
- AI code review

## When Working on Audit Issues

Issues labeled `audit` come from maina's daily verification audit. They contain:
- Verification findings (which tool, file, line, message)
- Slop detection results
- Test failures

Focus on fixing the specific findings listed. Don't refactor surrounding code unless directly related.
