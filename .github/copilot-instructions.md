# Copilot Instructions

You are working on a codebase verified by [Maina](https://mainahq.com), the verification-first developer OS. Maina MCP tools are available to you — use them.

## Workflow

When fixing an issue or implementing a feature:

1. **Get context first** — call the `context` tool with the files or question you are working on
2. **Write tests first** — TDD always. Write failing tests, then implement
3. **Verify your work** — call `verify` before requesting review (it includes slop detection: no empty bodies, no placeholder code, no console.log). Fix any findings
4. **Review your code** — call `review_triage` with your diff to catch issues before human review

## Available MCP Tools

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
