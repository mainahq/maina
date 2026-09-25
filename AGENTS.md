# AGENTS.md

Instructions for AI agents working in this repository.

## Project

Maina — verification-first developer OS. Three engines: Context (observes), Prompt (learns), Verify (verifies).

## Rules

- **Runtime:** Bun (NOT Node.js)
- **Lint/Format:** Biome 2.x (NOT ESLint/Prettier)
- **Test:** bun:test (NOT Jest/Vitest)
- **Error handling:** Result<T, E> pattern. Never throw.
- **Commits:** Conventional commits. Scopes: cli, core, mcp, skills, docs, ci.
- **TDD:** Write tests first, then implement.
- **Separation:** WHAT/WHY in spec.md, HOW in plan.md.
- **Ambiguity:** Use `[NEEDS CLARIFICATION: question]` markers. Never guess.

## v1 rules (see CLAUDE.md for detail)

- Functional core: no `process.*`, `console`, `throw` or classes in `packages/core`; inject ports; `Result` types; `readonly` data. `process.cwd/env/stdout`, `console.*` and `throw` are checked by the `packages/core/src/__tests__/purity.test.ts` ratchet (legacy offenders listed in `purity-allowlist.ts`, which may only shrink).
- Branch off `v1/main`, PR into `v1/main`; one issue per PR; TDD; commit via `maina commit`.
- Fail closed; never overwrite user config; one source of truth for versions, tools and counts.

## Verification

Before committing, run: `bun run verify` (biome check + tsc --noEmit + bun test).

## Structure

Bun monorepo with workspaces: `packages/cli`, `packages/core`, `packages/mcp`, `packages/skills`.
