# Project Constitution

Non-negotiable rules. Injected into every AI call. Not subject to A/B testing.

## Stack
- Runtime: Bun (NOT Node.js)
- Language: TypeScript strict mode
- Lint/Format: Biome 2.x (NOT ESLint/Prettier)
- Test: bun:test (NOT Jest/Vitest)
- Build: bunup
- CLI: Commander 13 + @clack/prompts
- AI: Vercel AI SDK v6 via OpenRouter
- DB: bun:sqlite + Drizzle ORM
- AST: web-tree-sitter

## Architecture
- Three engines: Context (observes), Prompt (learns), Verify (verifies)
- All DB access through repository layer
- API responses use { data, error, meta } envelope
- Error handling: Result<T, E> pattern. Never throw.
- Single LLM call per command (exception: PR review gets two)
- Each command declares its context needs via selector

## Verification
- All commits pass: biome check + tsc --noEmit + bun test
- Syntax guard rejects before other gates run
- Diff-only: only report findings on changed lines
- No console.log in production code

## Conventions
- Conventional commits: scopes are cli, core, mcp, skills, docs, ci
- TDD: write tests before implementation
- WHAT/WHY in spec.md, HOW in plan.md — never mixed
- [NEEDS CLARIFICATION] markers for ambiguity — never guess
