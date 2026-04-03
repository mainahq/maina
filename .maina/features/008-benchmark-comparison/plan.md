# Benchmark: Claude + Superpowers vs Claude + Maina

> Data collected from git history (77 commits), stats.db (28 snapshots), feedback.db (93 samples),
> 3 benchmark files, and spec quality scores across 10 sprints of building maina itself.

## Project Scale

| Metric | Value |
|--------|-------|
| Sprints | 10 (0-9) |
| Commits | 77 |
| Tests | 820 (802 pass, 18 fail) |
| Lines of code | ~31,000 |
| Packages | 4 (core, cli, mcp, skills) |
| Features specced | 7 (with spec/plan/tasks artifacts) |
| CLI commands | 20 |
| MCP tools | 8 |

---

## Sprint-by-Sprint Progression

### Phase 1: No Maina (Sprints 0-2) — Claude + Superpowers Only

| Sprint | Focus | Commits | What Superpowers Provided |
|--------|-------|---------|---------------------------|
| 0 | Monorepo scaffold | 7 | brainstorming, writing-plans skills |
| 1 | Context Engine | 1 | TDD skill, manual verification |
| 2 | Cache + Prompt Engine | 3 | Plan execution skill, manual code review |

**What worked:** Superpowers skills gave structured process (brainstorm → plan → execute).
**What was missing:** No persistent context across sessions. No automated verification. No spec/plan artifacts on disk. Every session started cold.

### Phase 2: Maina Bootstrapping (Sprints 3-5) — Building Verification + Dogfooding

| Sprint | Focus | Commits | First Maina Capabilities |
|--------|-------|---------|--------------------------|
| 3 | Verify Engine | 10 | `maina verify` — first automated gate |
| 4 | Features/Plans/Specs | 14 | `maina plan`, `maina spec`, `maina analyze` — artifact-driven development |
| 5 | Stats Tracker | 11 | `maina stats`, `maina commit` — first metrics, first dogfooding |

**Crossover point:** Sprint 5 — maina started verifying its own commits.
**First benchmark:** Sprint 5 — 9 tracked commits, avg verify 8.5s, 0 findings/commit.

### Phase 3: Full Pipeline (Sprints 6-9) — Claude + Maina

| Sprint | Focus | Commits | Maina Additions |
|--------|-------|---------|-----------------|
| 6 | PR + Init | 6 | `maina pr`, `maina init`, two-stage review |
| 7 | MCP Server | 6 | 8 MCP tools — IDE integration |
| 8 | RL Feedback | 11 | Feedback loop, A/B testing, prompt evolution |
| 9 | Spec Quality | 9 | Karpathy-principled spec scoring, preferences |

---

## Comparison: Before Maina vs After Maina

### 1. Verification Coverage

| Metric | Superpowers (Sprints 0-2) | Maina (Sprints 5-9) |
|--------|---------------------------|---------------------|
| Automated verification | None | 4 tools (biome, semgrep, trivy, secretlint) |
| Avg verify time | N/A (manual) | 8.8s per commit |
| Findings per commit | Unknown | 2.2 (rolling avg) |
| Syntax guard | None | Every commit, <500ms |
| Slop detection | None | AI output validated before user sees it |
| Secret scanning | None | Automated via secretlint |
| Vulnerability scanning | None | Automated via trivy |

**Result:** Every commit now passes through 4 security/quality tools. Zero manual effort.

### 2. Context Quality

| Metric | Superpowers | Maina |
|--------|-------------|-------|
| Context persistence | None (dies with session) | 4 layers, persisted to DB |
| Semantic awareness | None | tree-sitter AST, PageRank dependency graph |
| Episodic memory | None | 60 entries with Ebbinghaus decay |
| Token utilization | Unknown | 5,727 tokens / 200k budget (2.9%) |
| Context assembly | Manual CLAUDE.md reading | Automatic per-command assembly |

**Result:** Maina assembles focused context automatically. Sessions don't start cold.

### 3. Plan Quality

| Metric | Superpowers | Maina |
|--------|-------------|-------|
| Artifact persistence | In-conversation only | spec.md + plan.md + tasks.md on disk |
| Spec/plan separation | Not enforced | Analyzer catches violations |
| Acceptance criteria tracking | Manual | Automated coverage checking |
| Spec quality scoring | None | 0-100 score (measurability, testability, ambiguity, completeness) |
| Average spec quality | N/A | 67/100 across 7 features |
| Spec evolution | Not tracked | Scored per feature, trending visible |

**Result:** Specs improved from 48/100 (feature 001) to 84/100 (feature 004) as the analyzer enforced discipline.

### 4. Feedback Loop

| Metric | Superpowers | Maina |
|--------|-------------|-------|
| Prompt improvement | Manual | A/B tested, auto-promoted at >5% improvement |
| Feedback tracking | None | 93 samples across 2 tasks |
| Commit prompt health | N/A | 93% accept rate (57 samples) — healthy |
| Review prompt health | N/A | 44% accept rate (36 samples) — flagged for improvement |
| Rule learning | None | Noisy rules auto-downgraded via preferences.json |

**Result:** The system identifies which prompts need work and proposes improvements.

### 5. Development Speed

| Metric | Superpowers | Maina |
|--------|-------------|-------|
| Avg total commit time | Unknown | 14.6s (verify + hooks + context + stats) |
| Pre-commit checks | lefthook only (biome + tsc) | lefthook + maina verify (4 tools + slop + diff filter) |
| Cache hits | N/A | 0% (needs usage — identified gap) |

**Note:** Speed comparison is incomplete because we don't have Superpowers timing data. The 14.6s includes verification that Superpowers didn't do at all.

---

## Data Gaps (Honest Assessment)

| Gap | Why | Impact |
|-----|-----|--------|
| No Superpowers baseline timing | Superpowers doesn't track metrics | Can't compare speed |
| Cache hit rate is 0% | Cache keys not yet exercised in repeated workflows | No cache benefit measurable yet |
| Token utilization is <3% | Context budget is 200k but context is small | Budget system oversized |
| No cost tracking | API spend not instrumented | Can't measure $/commit |
| Sprint 1-4 have no benchmarks | Stats tracker built in Sprint 5 | Early data reconstructed from git log only |
| Single developer | No A/B team comparison | Results are anecdotal, not statistical |

---

## Key Takeaways

1. **Verification went from 0 to 4-tool automated pipeline.** Every commit now scanned for security vulnerabilities, secrets, linting issues, and AI slop. This is the clearest win.

2. **Spec quality improved 75% (48→84) as the analyzer enforced WHAT/WHY vs HOW separation.** The analyzer's spec-coverage and separation-violation checks drove measurable improvement.

3. **Prompt evolution identifies what's working and what isn't.** The commit prompt (93% accept) vs review prompt (44% accept) gives actionable signal for improvement.

4. **Context persistence eliminates cold starts.** Working context, semantic index, and episodic memory carry forward across sessions — something Superpowers fundamentally cannot do.

5. **The biggest gap is cache utilization.** The 3-layer cache exists but hit rate is 0%. This is the highest-ROI improvement to make next.
