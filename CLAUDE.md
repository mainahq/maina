# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Maina — verification-first developer OS. CLI + MCP server + skills package that proves AI-generated code is correct before it merges. Three engines: Context (observes), Prompt (learns), Verify (verifies).

Product spec and implementation plan live in the private `mainahq/maina-cloud` repo under `strategy/` (moved out on 2026-04-18 to keep roadmap private).

## v1 rebuild (in progress, ships as 2.0.0)

1.x is treated as a POC being refactored in place. Positioning: **guardrails for AI coding agents**; decides in milliseconds whether an agent action is allowed, asked or denied. Spec/plan: `maina-cloud:strategy/maina-v1/`. Tracking epic: mainahq/maina#365. Every task is one GitHub issue labelled `v1`; cite its FR IDs.

- **Branching:** branch per issue off `v1/main` (`v1/<issue>-<slug>`), PR into `v1/main`. Never PR v1 work into `master`.
- **Dogfood:** use `maina verify`, `maina commit` (never raw `git commit`, never `--skip`) and receipts. Friction → issue labelled `dogfood`; P0 (wrong allow, crash, no override path) blocks the next wave.
- **Target layering:** `core` = pure functions over explicit inputs + injected ports · `runtime` = process concerns (root, config, IPC, MCP, model) · adapters = host event normalisation, no decisions · surfaces (plugins, docs) = generated packaging only.

## Functional core rules

- No `process.cwd()`, `process.env`, `console.*`, `process.stdout`, `throw` or direct `Bun.spawn` in `packages/core`. Side effects go through `CorePorts` (`packages/core/src/ports`: `fs, git, db, clock, logger, model, env, process`; in-memory fakes in `ports/testing.ts`); logs go to stderr via the logger port. Child processes go through `ProcessPort` (real adapter: `core/src/process`, which drops leaked repo-local `GIT_*` vars).
- **Purity ratchet:** `packages/core/src/__tests__/purity.test.ts` statically scans non-test `packages/core/src` files for those six constructs. Only this first rule is machine-checked; the rest are enforced in review. Legacy 1.x offenders are grandfathered in `purity-allowlist.ts` with exact per-file, per-rule counts, so the test fails CI when an unlisted file offends, when a listed file's count rises, and when a count falls without the entry being lowered (or removed once clean). The list only shrinks: never add an entry to pass a new violation.
- Return `Result<T, E>` for anything fallible; errors are typed discriminated unions, not strings, in new code.
- No classes. Plain functions and data; `readonly` types; discriminated unions for variants; exhaustive `switch` with a `never` check.
- Small pure functions composed together; I/O at the edges. No new FP framework (no Effect/fp-ts): KISS.
- One source of truth: versions, tool lists, hook mappings, decision types and counts are defined once and generated elsewhere (docs included).
- Never overwrite user files: merge managed keys/regions, back up before first write, support clean uninstall.
- Fail closed: any gate path that errors resolves to `ask` (or `deny` where the host has no `ask`).
- Every public capability has tests; performance budgets are bench tests in CI.

## Stack

- **Runtime:** Bun (NOT Node.js)
- **Language:** TypeScript strict mode
- **Lint/Format:** Biome 2.x (NOT ESLint/Prettier)
- **Test:** bun:test (NOT Jest/Vitest)
- **Build:** bunup
- **CLI:** Commander 13 + @clack/prompts
- **AI:** Vercel AI SDK v6 via OpenRouter
- **DB:** bun:sqlite + Drizzle ORM
- **AST:** web-tree-sitter
- **Git hooks:** lefthook + commitlint

## Commands

```bash
bun install              # Install dependencies
bun run build            # Build all packages
bun run dev              # Dev mode
bun run check            # Biome lint + format check
bun run typecheck        # tsc --noEmit
bun run test             # Run all tests
bun test --filter <pat>  # Run specific tests
bun run verify           # Full verification: check + typecheck + test
```

## Monorepo Structure

```
packages/
├── cli/       # Commander entrypoint, commands (thin wrappers over engines), terminal UI
├── core/      # Three engines + cache + AI + git + DB + hooks
│   └── src/
│       ├── context/   # Context Engine: 4-layer retrieval, PageRank, budget, tree-sitter
│       ├── prompts/   # Prompt Engine: constitution, custom prompts, versioning, A/B testing
│       ├── verify/    # Verify Engine: syntax guard → parallel tools → diff filter → AI fix → review
│       ├── features/  # Feature directory management, auto-numbering
│       ├── cache/     # 3-layer: LRU memory → SQLite → API
│       ├── ai/        # Vercel AI SDK wrapper, model tiers
│       ├── feedback/  # RL feedback collection
│       ├── git/       # Git operations via the ProcessPort
│       ├── hooks/     # Lifecycle hook executor
│       └── db/        # Drizzle schemas
├── mcp/       # MCP server (delegates to engines)
└── skills/    # Cross-platform skills (Claude Code, Cursor, Codex, Gemini CLI)
```

## Architecture

- **Context Engine** has 4 layers: Working (current branch/files) → Episodic (PR summaries with Ebbinghaus decay) → Semantic (tree-sitter AST, PageRank-scored dependency graph) → Retrieval (Zoekt code search). Dynamic token budget: 60% default, 80% explore, 40% focused. Each command declares its context needs via a selector.
- **Prompt Engine** loads constitution (`.maina/constitution.md`) + custom prompts (`.maina/prompts/`). Prompts are hashed and versioned. Feedback drives A/B-tested evolution.
- **Verify Engine** pipeline: syntax guard (Biome, <500ms) → parallel deterministic tools (Semgrep, Trivy, Secretlint, SonarQube, diff-cover, Stryker, slop detector) → diff-only filter → AI fix → two-stage review (spec compliance then code quality).
- **Cache** keys on `hash(prompt_version + context_hash + model + input)`. Same query never hits AI twice.
- **Single LLM call per command** (exception: PR review gets two for the two-stage review).

## Conventions

- **TDD always.** Write tests first, watch them fail, implement, watch them pass.
- **Conventional commits.** Scopes: `cli`, `core`, `mcp`, `skills`, `docs`, `ci`.
- **Error handling:** `Result<T, E>` pattern. Never throw.
- **WHAT/WHY in spec.md, HOW in plan.md** — never mixed.
- **`[NEEDS CLARIFICATION]` markers** for ambiguity in AI output — never guess.
- **Diff-only:** only report findings on changed lines.
- **Constitution** (`.maina/constitution.md`) is stable project DNA, not subject to A/B testing.
- All DB access through repository layer.
- API responses use `{ data, error, meta }` envelope.
- No `console.log` in production code.

## Model Tiers

- **mechanical:** cheap/fast (tests, commit msgs, slop detection, compression)
- **standard:** mid-tier (reviews, plans, design docs)
- **architectural:** powerful (design review, architecture, prompt evolution)
- **local:** Ollama for offline use
