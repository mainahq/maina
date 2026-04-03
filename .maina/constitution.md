# Project Constitution

Non-negotiable rules. Injected into every AI call. Not subject to A/B testing.
Updated: 2026-04-03 (Sprint 9)

## Stack
- Runtime: Bun (NOT Node.js)
- Language: TypeScript strict mode
- Lint/Format: Biome 2.x (NOT ESLint/Prettier)
- Test: bun:test (NOT Jest/Vitest)
- Build: bunup
- CLI: Commander 13 + @clack/prompts
- AI: Vercel AI SDK v6 via OpenRouter (host delegation when inside Claude Code/Cursor)
- DB: bun:sqlite + Drizzle ORM (split by purpose: context, cache, feedback, stats)
- AST: web-tree-sitter
- MCP: @modelcontextprotocol/sdk (stdio transport)

## Architecture
- Three engines: Context (observes), Prompt (learns), Verify (verifies)
- 20 CLI commands, 8 MCP tools, 5 cross-platform skills
- All DB access through repository layer (getContextDb, getCacheDb, getFeedbackDb, getStatsDb)
- Error handling: Result<T, E> pattern. Never throw.
- Single LLM call per command (exception: PR review gets two)
- Each command declares its context needs via selector
- AI output validated by slop guard before reaching user
- Shared utilities in packages/core/src/utils.ts (toKebabCase, extractAcceptanceCriteria)
- tryAIGenerate() is the single entry point for all AI calls

## Context Engine
- 4 layers: Working → Episodic → Semantic → Retrieval
- Every maina commit writes episodic entry + working context + stats snapshot
- Semantic index: tree-sitter entities + PageRank dependency graph (persisted to DB)
- Retrieval: ripgrep/grep with auto-generated search queries from recent changes
- Dynamic budget: 40% focused, 60% default, 80% explore

## Verification
- All commits pass: biome check + tsc --noEmit + bun test
- Syntax guard rejects before other gates run
- Diff-only: only report findings on changed lines
- Slop detector cached via CacheManager in pipeline
- Preferences.json tracks noisy rules (high false positive rate)
- Spec quality scored 0-100 (measurability, testability, ambiguity, completeness)
- Skip events tracked in stats.db

## Feedback Loop
- Every AI call records prompt hash + outcome to feedback.db
- Accepted reviews compressed to <500 tokens as episodic few-shot examples
- A/B testing: candidates auto-promoted at >5% improvement, retired at <-5%
- maina learn analyzes feedback and proposes prompt improvements

## Conventions
- Conventional commits: scopes are cli, core, mcp, skills, docs, ci
- TDD: write tests before implementation (5 categories: happy, edge, error, security, integration)
- WHAT/WHY in spec.md, HOW in plan.md — never mixed
- [NEEDS CLARIFICATION] markers for ambiguity — never guess
- Dogfood: use maina plan/spec/analyze/commit for all development
- Self-improvement: after each commit run stats + review + context check
- No console.log in production code
