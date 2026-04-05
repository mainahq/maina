# v0.3.x Design — Hardening: Verify Gaps + RL Loop + HLD/LLD

**Date:** 2026-04-05
**Version:** v0.3.x (Sprint 11 + HLD/LLD extension)
**Goal:** Make `maina verify` effective without external tools. Close the gap exposed by the Tier 3 benchmark. Add AI-powered review, HLD/LLD generation, automation flags, and a fully automatic RL improvement loop.

---

## Context

Tier 3 benchmark (2026-04-03): SpecKit achieved 100% on 95 hidden validation tests. Maina got 97.9% (2 bugs). SpecKit's 58s self-review caught 4 issues that Maina's verify missed because no external tools were installed. Verify returned "0 findings, passed" — false confidence.

Additionally, `maina design` only produces ADRs with no HLD/LLD output, and `maina spec`/`maina design` lack `--auto` flags, blocking CI and benchmark automation.

## Approach

Sequential bottom-up: deterministic checks first (standalone value), then AI-powered features (layers on top), then automation + RL (needs full pipeline).

**Dogfooding throughout:** Every commit goes through `maina commit`. MCP tools (reviewCode, checkSlop, getContext) used for review. `maina verify` runs before PRs.

---

## Phase 0: Fix regressions (prerequisite)

Triage and fix all 43 failing tests. Clusters:

- Language profiles (~28 tests) — likely regressions from feature 023 (enterprise languages)
- Slop detector + cache (~7 tests)
- Verify pipeline / detect tools / syntax guard (~5 tests)
- AI review (~3 tests)

Fix root causes, don't paper over. All 1036 tests must pass before Sprint 11 work begins.

---

## Phase 1: Deterministic built-in checks

### T1 — Built-in type checking

**File:** `packages/core/src/verify/typecheck.ts`

- Run `tsc --noEmit` as a verify step, zero external install needed
- Parse output into `Finding[]` with file, line, message
- Language-aware: mypy for Python, go vet for Go, dotnet build for C#, javac for Java
- Uses project's own config (tsconfig.json, pyproject.toml, etc.)

### T2 — Cross-function consistency check

**File:** `packages/core/src/verify/consistency.ts`

- Deterministic AST-based check using tree-sitter
- Catches the exact bug class that lost 2 points in Tier 3 benchmark
- Mechanism: reads spec.md for stated constraints (e.g., "use isIP for IP hosts"), builds a rule set, then walks AST call sites to verify compliance
- If no spec.md exists, falls back to heuristic patterns: functions that call a validator on one code path but skip it on another
- Pattern-matching on call sites, cross-referencing function signatures

### T3 — "0 tools available" warning

**File:** `packages/core/src/verify/pipeline.ts`

- When `detectTools()` returns 0 external tools: report WARNING, suggest `maina init --install`
- Never report "0 findings, passed" when no tools ran
- Built-in checks (typecheck, consistency, slop) still run regardless

### T4 — `maina init` auto-configures Biome

**File:** `packages/core/src/init/biome-setup.ts`

- During `maina init`: detect Biome, offer to install + configure with sensible defaults
- Every maina-initialized project gets at least one real linter out of the box

---

## Phase 2: AI-powered verification + HLD/LLD

### T5 — AI self-review in verify

**File:** `packages/core/src/verify/ai-review.ts`

**Mechanical tier (always-on):**
- Runs on every verify
- Input: git diff + 3 most-referenced functions from context engine
- Checks: cross-function consistency, edge cases, spec compliance
- Target: <3s
- Uses AI delegation protocol (`---MAINA_AI_REQUEST---`) inside Claude Code, falls back to OpenRouter standalone
- Severity capped at `warning`

**Standard tier (`--deep` flag):**
- Full semantic review against spec
- Deeper analysis, higher quality model
- Target: <15s
- Severity `error` allowed

**Common:**
- Findings use existing `Finding` interface with `tool="ai-review"`
- Never blocks on AI failure — degrades gracefully to deterministic checks only

### T6 — HLD/LLD generation in `maina design`

**File:** `packages/core/src/design/`

- Extend current ADR output with HLD section: system overview, components, data flow, dependencies
- Add LLD section: interfaces, function signatures, schemas, sequence diagrams, error handling, edge cases
- AI-generated from spec.md via standard tier model
- New prompt template `design-hld-lld.md` in `packages/core/src/prompts/defaults/`
- Output written to feature directory alongside existing ADR

---

## Phase 3: Automation + RL loop

### T7 — `--auto` flags for `maina spec` and `maina design`

- Skip interactive prompts, use sensible defaults from context engine
- Enables full workflow automation in CI and scripting
- `maina spec --auto` generates spec from context without prompts
- `maina design --auto` generates ADR + HLD/LLD without prompts

### T8 — Post-workflow RL trace analysis

**File:** `packages/core/src/feedback/trace-analysis.ts`

- After a full workflow completes (brainstorm -> ... -> pr):
  1. Collect full trace: every step's context, prompt used, output, feedback
  2. Analyze: which prompts led to accepted outputs? Which got rejected/modified?
  3. Propose prompt improvements based on trace patterns
  4. Automatically feed into `maina learn` — no human review gate
- Runs as background task after `maina pr` completes
- Closes the full RL loop: use -> observe -> improve -> repeat

---

## Execution order

```
Phase 0: Fix 43 failing tests
  |
Phase 1: typecheck -> consistency -> 0-tools warning -> Biome init
  |
Phase 2: AI self-review (mechanical + deep) -> HLD/LLD in design
  |
Phase 3: --auto flags -> post-workflow RL trace analysis
  |
Tag v0.3.x
```

## Success criteria

- [ ] All existing tests pass (0 failures)
- [ ] `maina verify` on a fresh project (no external tools) produces meaningful findings via built-in typecheck + AI self-review
- [ ] "0 tools available" shows a warning, not a false pass
- [ ] `maina verify --deep` runs standard-tier AI review against spec
- [ ] `maina init` configures Biome automatically
- [ ] `maina design` outputs HLD/LLD alongside ADR
- [ ] `maina spec --auto` and `maina design --auto` work without interaction
- [ ] Post-workflow RL trace analysis runs automatically and feeds `maina learn`
- [ ] AI delegation protocol used inside Claude Code (no OpenRouter in that context)
- [ ] Tier 3 benchmark re-run: Maina matches or beats SpecKit's 100%
