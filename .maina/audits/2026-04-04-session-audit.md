# Session Audit: 2026-04-04

## Bugs Found During Session

| # | Bug | How Found | Root Cause | Fix | Prevention |
|---|-----|-----------|------------|-----|------------|
| 1 | **AI features non-functional in host mode** | User pointed out AI slop didn't catch anything | `tryAIGenerate` returned `[HOST_DELEGATION]` string, nobody processed it | PR #28 — structured `DelegationPrompt` type | Integration test: verify AI output is not delegation text |
| 2 | **ADR committed with 15 placeholders** | User noticed ADR 0002 was empty | `--hld` silently failed, `review-design` only warned | PR #12 (error on >5 markers) + PR #28 (delegation fix) | Design review BLOCKS on empty ADRs (done) |
| 3 | **A/B test was dead code** | User asked why 0 candidate samples after 5 PRs | `buildSystemPrompt` never called `abTest()` | PR #21 — wired abTest into prompt resolution | Integration test: verify candidate prompts are actually served |
| 4 | **Tool detection broken for multi-arg flags** | Manual QA — Playwright not detected | `Bun.spawn([cmd, "playwright --version"])` — single arg | Direct fix — split version flag on spaces | Test with multi-arg tools in detect tests |
| 5 | **`maina visual update` blocked on monorepos** | Manual QA — "Not a web project" | `detectWebProject` only checked root package.json | Direct fix — skip check when URLs configured | Test monorepo scenario |
| 6 | **`maina learn` hangs in non-interactive mode** | Couldn't run learn from agent/CI | No `--no-interactive` flag | PR #21 — added flag | All interactive commands need non-interactive mode |
| 7 | **Tests hardcoded tool availability** | Tests broke after installing sonarqube | `expect(sonarqube.available).toBe(false)` | Direct fix — test shape not value | Never hardcode tool availability in tests |
| 8 | **MCP review leaked delegation text** | MCP reviewCode output showed `[HOST_DELEGATION]` | Review code pushed delegation text as "AI review" finding | PR #28 — only include when `fromAI: true` | Filter all user-facing output for delegation markers |
| 9 | **Slop false positives on .md files** | `maina verify --all` failed on plan.md | Import detection runs on markdown code blocks | Not fixed yet | Skip .md files in hallucinated import detection |
| 10 | **PR #12 masked the real problem** | User caught during RCA | Extracted user prompt and returned as "content" | Reverted in PR #28 | Don't mask failures — return null honestly |

## Systemic Issues

1. **No integration test for AI path** — Unit tests mock AI, so host delegation was never tested end-to-end
2. **No "smoke test" for host mode** — Should verify that in CLAUDECODE=1 env, commands degrade gracefully
3. **Manual QA caught 4 of 10 bugs** — Testing didn't catch them. Need better coverage for edge cases
4. **User caught 6 of 10 bugs** — The RL loop (user feedback) is our best bug detector right now

## Action Items

- [ ] Add smoke test for host mode (CLAUDECODE=1, no API key)
- [ ] Integration test: AI review output must not contain [HOST_DELEGATION]
- [ ] Integration test: abTest() actually serves candidate prompts
- [ ] Skip .md files in hallucinated import detection (slop)
- [ ] All interactive CLI commands need --no-interactive flag
- [ ] Never hardcode tool availability in tests
