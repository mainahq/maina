# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Maina — verification-first developer OS. CLI + MCP server + skills package that proves AI-generated code is correct before it merges. Three engines: Context (observes), Prompt (learns), Verify (verifies).

Read PRODUCT_SPEC.md for full product context. Read IMPLEMENTATION_PLAN.md for sprint-by-sprint execution plan.

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
│       ├── git/       # Git operations via Bun.spawn
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
