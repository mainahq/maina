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

## Workflow Order (mandatory, sequential)

Every feature follows this exact sequence using maina CLI/MCP tools. No skipping steps.

```
maina brainstorm  → explore idea, generate structured ticket
maina ticket      → create GitHub Issue with module tagging
maina plan <name> → scaffold feature branch + directory
maina design      → create ADR (+ HLD/LLD with --hld)
maina spec        → generate TDD test stubs from plan
implement         → write code (TDD: red → green → refactor)
maina verify      → run full verification pipeline
maina review      → comprehensive code review
fix               → address review findings
maina commit      → verify + commit staged changes
maina review      → final review pass
maina pr          → create PR with verification proof
```

Between steps, use MCP tools for continuous checks:
- `getContext` — before any AI-assisted step
- `checkSlop` — after writing code
- `reviewCode` — before committing
- `verify` — before PRs
- `analyzeFeature` — check spec/plan/task consistency

## Conventions
- Conventional commits: scopes are cli, core, mcp, skills, docs, ci
- TDD: write tests before implementation (5 categories: happy, edge, error, security, integration)
- WHAT/WHY in spec.md, HOW in plan.md — never mixed
- [NEEDS CLARIFICATION] markers for ambiguity — never guess
- Dogfood: use maina CLI/MCP tools for the entire workflow — never raw git commit, never skip maina tools
- Self-improvement: after each commit run stats + review + context check
- No console.log in production code

## Related Projects

Cross-repo dogfooding flywheel. Report issues to each other with `maina ticket --repo <name>`.

| Project | Path | Repo | Relationship |
|---------|------|------|-------------|
| maina-cloud | /Users/Bikash/try/maina-cloud | mainahq/maina-cloud (private) | Cloud backend — consumes maina's API types, runs verification pipeline |
| workkit | /Users/Bikash/try/workkit | beeeku/workkit | CF Workers utilities — @workkit/* packages power maina-cloud |

- **maina → maina-cloud:** API type changes here must be synced to cloud. Cloud bugs found during CLI testing → `maina ticket --repo maina-cloud`
- **maina → workkit:** @workkit bugs found during maina-cloud development → `maina ticket --repo workkit`
- **maina-cloud → maina:** CLI client bugs or missing features → `maina ticket --repo maina`
- **workkit → maina:** Verification pipeline bugs found during Workkit dogfooding → `maina ticket --repo maina`
