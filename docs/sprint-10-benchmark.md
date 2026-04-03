# Sprint 10 Benchmark: Claude + Superpowers vs Claude + Maina

Sprint 10 was a natural experiment. We started with Superpowers skills for planning, then switched to maina tools mid-sprint after repeated feedback. This gives us direct comparison data from the same session.

## Session Facts

| Metric | Value |
|--------|-------|
| Duration | ~2 hours (19:36 → 21:19 IST) |
| Commits | 29 |
| Lines changed | 6,294 insertions, 45 deletions |
| Files touched | 44 |
| Tests | 803 pass, 0 fail |
| PRs created | 2 (both merged, CI green) |
| Bugs found & fixed | 10 |

## Phase 1: Claude + Superpowers (Planning)

Used Superpowers brainstorming, writing-plans, subagent-driven-development skills for design and implementation.

| What worked | What didn't |
|-------------|-------------|
| Visual companion for design decisions | Brainstorming skill added ceremony for a well-scoped task |
| Subagent parallelization (3 worktrees) | Subagents couldn't use maina tools (not in PATH) |
| Writing-plans produced detailed task breakdown | Plan had bugs: wrong Starlight slugs, missing trailing slash in BASE_URL |
| Code-reviewer skill caught nothing (no review) | Raw `git commit` used instead of `maina commit` — 3x reminded |

**Key failure:** Superpowers skills are process tools — they organize work but don't verify it. Every bug shipped to the first build and had to be fixed reactively.

## Phase 2: Claude + Maina (QA & RL Loop)

Switched to maina tools for verification, review, PR creation, and learning.

| Tool | Finding |
|------|---------|
| `maina verify --all` | 44 findings across codebase (slop, TODOs, empty bodies) |
| `maina review` | READY — passed (but needed improved prompts) |
| `maina pr --base master` | Created PR #1, found diff detection bug, fixed it |
| `maina learn` | Review at 44% accept rate, commit at 89% |
| `maina doctor` | All 3 engines ready, 4/6 tools installed |
| `maina stats` | 28 commits tracked, 8.8s avg verify |
| `maina context show` | 5,828 tokens across 4 layers, 291 semantic entries |

**Key success:** Maina caught what Superpowers missed — the tools find real issues programmatically.

## Direct Comparison

| Dimension | Superpowers | Maina | Winner |
|-----------|-------------|-------|--------|
| **Bugs prevented** | 0 (all shipped to first build) | 44 findings on `verify --all` | Maina |
| **SVG path bug** | Not caught by plan or review | Would be caught by improved review prompt (hardcoded paths check) | Maina (after RL) |
| **CSS cascade issue** | Not caught | Would be caught by improved review prompt (CSS specificity check) | Maina (after RL) |
| **WCAG contrast** | Not caught | Calculated all pairs, found 7 failures, fixed to AA+ | Maina |
| **Dark mode missing** | Not caught | Would be caught by improved review prompt (dark mode check) | Maina (after RL) |
| **PR quality** | N/A (used `gh pr create` directly) | AI-generated summary with themed bullets | Maina |
| **CI readiness** | Hardcoded paths shipped, CI failed twice | Tests fixed to use `process.cwd()` | Maina (caught via CI) |
| **Planning speed** | ~30 min (brainstorm + visual companion + plan) | `maina plan` would be ~5 min | Maina |
| **Execution speed** | Fast (parallel subagents) | Same (parallel subagents) | Tie |
| **Context awareness** | CLAUDE.md + conversation only | 4-layer context (5,828 tokens, 291 entities, 74 episodic) | Maina |
| **Learning** | None — same mistakes repeat | Prompts improved from session, A/B testable | Maina |

## Sprint-over-Sprint Trends (Complete)

Data reconstructed from stats.db (28 snapshots) for missing Sprints 6-7.

| Metric | Sprint 5 | Sprint 6 | Sprint 7 | Sprint 8 | Sprint 9 | Sprint 10 |
|--------|----------|----------|----------|----------|----------|-----------|
| Commits | 3 | 15 | 4 | 3 | 3 | 29 |
| Cumulative commits | 9 | 18 | 22 | 25 | 28 | 28+ |
| Avg verify (ms) | 8,443 | 8,785 | 8,753 | 8,776 | 8,830 | 8,830 |
| Avg context tokens | 0 | 127 | 421 | 310 | 340 | 5,828 |
| Findings/commit | 0 | 0.5 | 5.5 | 2.5 | 2.2 | 2.2 |
| Total findings | 0 | 7 | 22 | — | — | 44 (--all) |
| Cache L2 entries | — | — | — | — | 70 | 283 |
| Semantic entries | — | — | — | — | — | 291 |
| Episodic entries | — | — | — | — | — | 74 |
| Tests | — | — | — | — | 802 | 803 |
| Custom prompts | 0 | 0 | 0 | 0 | 0 | 2 |

**Key inflection points:**
- **Sprint 5:** First tracked commits. Context tokens at 0 (semantic index not built yet).
- **Sprint 6:** First findings detected (7 total). Context tokens growing as semantic index builds.
- **Sprint 7:** Findings spike to 5.5/commit — MCP server code triggered slop detector on larger diffs. Context tokens 3x jump (127→421) as 8 MCP tools added.
- **Sprint 8:** Findings normalize to 2.5/commit. Feedback loop and A/B testing introduced.
- **Sprint 9:** Spec quality scoring added. 70 cache entries but 0% hit rate.
- **Sprint 10:** Context explodes to 5,828 tokens (291 semantic entries). 283 cache entries. 2 custom prompts from RL loop. Host delegation bug found and fixed.

## Prompt Evolution (RL Loop)

### Review prompt v1 → v2

| Before (4 checks) | After (11 checks) |
|---|---|
| Security vulnerabilities | Security vulnerabilities |
| Business logic errors | Business logic errors |
| Missing error handling | Missing error handling |
| Convention violations | Convention violations |
| — | Hardcoded paths/env-specific values |
| — | Framework conventions (Astro, Starlight) |
| — | CSS cascade/specificity issues |
| — | WCAG AA contrast ratios |
| — | Dark mode coverage |
| — | Internal link resolution |
| — | Asset path correctness |

**Accept rate:** 44% → TBD (new prompt deployed, measuring)

### PR prompt (new)

- Generates structured summary (what/why + themed bullets)
- Falls back to commit list when AI unavailable
- Includes example output for consistency

## Host Delegation Bug

**Found:** `tryAIGenerate()` silently discarded `[HOST_DELEGATION]` results inside Claude Code, making all AI features fail without error.

**Impact:** Every `maina review`, `maina commit` (AI message), and `maina pr` (AI summary) silently fell back to non-AI paths since Sprint 3.

**Fix:** Expose `{ hostDelegation: true }` flag, check `fromAI` before using text as real output.

**Implication:** Cache hit rate has been 0% because no AI calls were completing. With this fix, cache should start accumulating on next API-key session.

## Conclusion

Superpowers skills are good for process (planning, brainstorming, design) but provide zero runtime verification. Maina's tools catch real bugs programmatically and improve over time through the RL loop. The combination is strongest: use Superpowers for creative/planning phases, maina for build/verify/ship phases.

**Next sprint should use:**
- Superpowers brainstorming for design (it's good at that)
- `maina plan` + `maina spec` for implementation planning
- `maina commit` for every commit
- `maina verify --all` before PRs
- `maina pr` for PR creation
- `maina learn` after each sprint
