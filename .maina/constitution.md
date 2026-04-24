# Project Constitution

Non-negotiable rules. Injected into every AI call. Not subject to A/B testing.
Updated: 2026-04-25 (Wave 1 Foundation — C1–C5 per direction doc 2026-04-25)

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
- **Three engines plus one artifact:** Context (observes), Prompt (learns), Verify (verifies) — emit a **Receipt** (proves)
- 20 CLI commands, 8 MCP tools, 5 cross-platform skills
- All DB access through repository layer (getContextDb, getCacheDb, getFeedbackDb, getStatsDb)
- Error handling: Result<T, E> pattern. Never throw.
- Single LLM call per command (exception: PR review gets two)
- Each command declares its context needs via selector
- AI output validated by slop guard before reaching user
- Shared utilities in packages/core/src/utils.ts (toKebabCase, extractAcceptanceCriteria)
- tryAIGenerate() is the single entry point for all AI calls

## Receipt (C1)

The receipt is the product's artifact. Every `maina pr` emits one (C5).

- **Shape:** per `adr/0030-receipt-v1-field-schema.md`. Wire format is `@mainahq/receipt-schema` v1 at `schemas.mainahq.com/v1.json`.
- **Integrity:** RFC 8785 canonicalize (with `hash` excluded from the canonicalization input) → sha256 (lowercase hex).
- **Fields record, not decorate:** prompt versions, agent identity, retry count, diff shape, and every check's outcome are structural data — the receipt is a document, not a dashboard.
- **Offline-verifiable:** `maina verify-receipt <path>` validates any receipt against the pinned schema without hosted infra. (CLI lands in companion [PR #235](https://github.com/mainahq/maina/pull/235).)
- **One receipt, three surfaces:** CLI (terminal), GitHub App (PR check + walkthrough comment), Enterprise rollup (fleet view). Same wire format across all three.

## Copy Discipline (C2)

All user-facing receipt + CLI + comment output follows affirmative verification framing. This is non-negotiable — it's the brand.

- **Bad:** "0 issues found", "no security findings", "no errors"
- **Good:** "passed 12 of 12 policy checks", "no secrets, no high-CVE deps, no risky AST patterns on diff", "all 847 tests passed"

Enforced at every emission point: verify CLI output, receipt HTML/JSON, GitHub App sticky comment, Slack posts. Copy is reviewed against this rule before landing in a PR.

## Agent-Retry Policy (C3)

Agents that can see their own verification receipts can grind-to-pass, which makes the signal worthless. Per `adr/0031-agent-retry-recording-policy.md`:

- Every receipt carries `retries: number` (non-negative integer).
- Default cap: **3**. Configurable via the `## Retry Policy` section below.
- At cap: receipt is emitted with `status: "partial"` regardless of underlying check outcomes, and downstream UI renders a visible "retried N times, capped" badge.
- Under cap with `retries > 0`: receipt emits its true status, plus a "retried N times" badge so reviewers weigh the signal accordingly.
- Retry counting: same branch + same HEAD agent-delta = one session; human commits reset the counter; agent-driven iterations increment.

### Retry Policy

- max_retries: 3
- partial_status_at_cap: true

## Cross-Agent Rules Interop (C4)

`.maina/constitution.md` is the **canonical source** for project rules. Maina emits these as derived views for other agent hosts — the constitution is the single edit surface:

- `.cursor/rules` — Cursor's rules format
- `CLAUDE.md` — Claude Code's project instructions (at repo root)
- `.github/copilot-instructions.md` — GitHub Copilot's project instructions

Emission is one-way (constitution → derived files) and runs in `maina setup` and on constitution changes. Never hand-edit the derived files. Materialization lands in Wave 5 per the direction doc.

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
- Feedback records will include `constitutionHash` so learnings follow the policy version (not the repo). *Schema field + persistence lands in Wave 2 (#229 receipt integration + feedback DB migration); the constitution locks the contract in Wave 1.*

## Workflow Order (mandatory, sequential)

Every feature follows this exact sequence using maina CLI/MCP tools. No skipping steps. `maina pr` is the terminal step — by Wave 2 it auto-generates the receipt (C5); today it appends verification proof to the PR body. No separate `maina receipt` action will exist.

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
maina pr          → create PR + auto-emit receipt (receipt emission lands in Wave 2)
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
- Copy discipline (C2) applies to every user-facing string — no "0 issues" framing anywhere

## Scaffold Rules (learned from CodeRabbit RL feedback, 2026-04-17)
- **Always fill spec.md, plan.md, tasks.md** before PR — never commit placeholder scaffolds
- **Plan must match implementation** — if plan says "Bun.Glob" but code uses custom regex, fix the plan
- **Remove spec-tests.ts** after writing real tests — placeholder `expect(true).toBe(false)` fails CI
- **ADR paths use `adr/` directory** — not `docs/decisions/`. Reference correctly in specs.
- **Context engine has 4 layers** (Working, Episodic, Semantic, Retrieval) — wiki is a view, not a layer
- **Mark tasks as [x] done** in tasks.md before PR — don't leave them as [ ] when implemented

## Related Projects

Cross-repo dogfooding flywheel. Report issues to each other with `maina ticket --repo <name>`.

| Project | Path | Repo | Relationship |
|---------|------|------|-------------|
| maina-cloud | mainahq/maina-cloud | mainahq/maina-cloud (private) | Cloud backend — consumes maina's API types, runs verification pipeline |
| workkit | mainahq/workkit | mainahq/workkit | CF Workers utilities — @workkit/* packages power maina-cloud |
| receipt-schema | mainahq/receipt-schema | mainahq/receipt-schema (public, MIT) | Canonical JSON schema for receipts; consumed as `@mainahq/receipt-schema` |

- **maina → maina-cloud:** API type changes here must be synced to cloud. Cloud bugs found during CLI testing → `maina ticket --repo maina-cloud`
- **maina → workkit:** @workkit bugs found during maina-cloud development → `maina ticket --repo workkit`
- **maina-cloud → maina:** CLI client bugs or missing features → `maina ticket --repo maina`
- **workkit → maina:** Verification pipeline bugs found during Workkit dogfooding → `maina ticket --repo maina`
- **receipt-schema:** Schema changes require an ADR in `mainahq/maina` and ship as `v2.json` — `v1.json` is immutable.
