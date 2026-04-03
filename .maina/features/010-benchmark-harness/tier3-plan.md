# Tier 3 Benchmark Plan — Full Lifecycle Comparison

## Problem with Tier 1-2

We only measured "implement + run tests" — ~20% of the real workflow. Both tools aced it because:
- Clean specs with no ambiguity
- Simple single-file libraries
- No verification-worthy bugs to catch
- No planning/review/commit/PR phases measured

## Tier 3 Requirements

### Full Lifecycle (both pipelines must execute every step)

**Maina pipeline (9 steps):**
1. `maina init` — scaffold .maina/ if needed
2. `maina plan` — generate plan.md from requirements
3. `maina spec` — interactive questions → test stubs
4. `maina design` — propose approaches → ADR
5. Implement — write the code
6. `maina verify` — run verification pipeline
7. `maina review` — two-stage code review
8. `maina commit` — AI commit message
9. `maina pr` — create PR with AI summary

**Spec Kit pipeline (9 steps):**
1. `specify init` — scaffold .specify/
2. `/speckit.specify` — write specification
3. `/speckit.plan` — write technical plan
4. `/speckit.tasks` — break into tasks
5. Implement — write the code
6. Claude Code built-in review (no equivalent to maina verify)
7. Code review via Claude Code
8. `git commit` — manual or AI commit
9. `gh pr create` — create PR

### Metrics per step
- Wall-clock time
- Tokens consumed
- Artifacts produced
- Bugs introduced (test failures at each checkpoint)
- Bugs caught (verification/review findings)

### Story candidate: `validator.js` subset (3-4 validators)
- `isEmail`, `isURL`, `isIP` — security-sensitive input validation
- Many edge cases, RFC compliance, unicode handling
- Verification should catch: injection patterns, missing edge cases, incorrect regex
- ~60-80 tests from the original suite
- Multi-function (not single-file trivial)

### Alternative: `sanitize-html` subset
- HTML sanitization with allowlists
- XSS-prone — verification SHOULD find issues
- Even more adversarial for the tools

## What to capture in results

```json
{
  "steps": {
    "init": { "durationMs": 0, "tokens": 0, "artifacts": [] },
    "plan": { "durationMs": 0, "tokens": 0, "artifacts": [], "questionsAsked": 0 },
    "spec": { "durationMs": 0, "tokens": 0, "testsGenerated": 0 },
    "design": { "durationMs": 0, "tokens": 0, "approachesProposed": 0 },
    "implement": { "durationMs": 0, "tokens": 0, "loc": 0, "attempts": 0 },
    "verify": { "durationMs": 0, "findings": 0, "findingsBySeverity": {} },
    "review": { "durationMs": 0, "tokens": 0, "issuesFound": 0, "passed": false },
    "commit": { "durationMs": 0, "tokens": 0 },
    "pr": { "durationMs": 0, "tokens": 0 }
  },
  "totals": {
    "durationMs": 0,
    "tokens": 0,
    "bugsIntroduced": 0,
    "bugsCaught": 0,
    "testsPassed": 0,
    "testsTotal": 0
  }
}
```

## Implementation plan for next session

1. Pick final tier 3 library (validator.js subset recommended)
2. Port ground-truth tests to bun:test
3. Update benchmark runner to capture per-step metrics
4. Write detailed agent prompts that enforce full lifecycle for both pipelines
5. Run both in worktrees
6. Compare and write final report
