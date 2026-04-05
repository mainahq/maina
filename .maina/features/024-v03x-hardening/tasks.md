# Task Breakdown

## Tasks

Each task should be completable in one commit. Test tasks precede implementation tasks.

### Phase 0: Fix regressions
- [ ] T0.1: Investigate 43 failing tests — categorize root causes
- [ ] T0.2: Fix language profile test failures (~28 tests)
- [ ] T0.3: Fix slop detector + cache test failures (~7 tests)
- [ ] T0.4: Fix verify pipeline / detect tools / syntax guard test failures (~5 tests)
- [ ] T0.5: Fix AI review test failures (~3 tests)
- [ ] T0.6: Fix maina ticket false-positive label matching
- [ ] T0.7: Run full test suite — confirm 0 failures
- [ ] T0.8: maina verify — confirm clean
- [ ] T0.9: maina commit — commit regression fixes

### Phase 1: Deterministic built-in checks
- [ ] T1.1: Write failing tests for typecheck.ts
- [ ] T1.2: Implement verify/typecheck.ts
- [ ] T1.3: Run tests — confirm green
- [ ] T1.4: Write failing tests for consistency.ts
- [ ] T1.5: Implement verify/consistency.ts
- [ ] T1.6: Run tests — confirm green
- [ ] T1.7: Write failing test for 0-tools warning in pipeline.ts
- [ ] T1.8: Modify pipeline.ts — add typecheck + consistency + 0-tools warning
- [ ] T1.9: Run tests — confirm green
- [ ] T1.10: Write failing test for Biome auto-config in init
- [ ] T1.11: Modify init/index.ts — Biome detect + install + defaults
- [ ] T1.12: Run tests — confirm green
- [ ] T1.13: maina verify + maina commit — commit Phase 1

### Phase 2: AI-powered verification + HLD/LLD
- [ ] T2.1: Write failing tests for mechanical always-on AI review
- [ ] T2.2: Modify verify/ai-review.ts — mechanical tier always runs
- [ ] T2.3: Run tests — confirm green
- [ ] T2.4: Write failing tests for HLD/LLD generation
- [ ] T2.5: Modify design/index.ts — generate HLD/LLD from spec
- [ ] T2.6: Run tests — confirm green
- [ ] T2.7: maina verify + maina commit — commit Phase 2

### Phase 3: Automation + RL loop
- [ ] T3.1: Add --auto flag to spec.ts and design.ts CLI commands
- [ ] T3.2: Test --auto flags end-to-end
- [ ] T3.3: Write failing tests for trace-analysis.ts
- [ ] T3.4: Implement feedback/trace-analysis.ts
- [ ] T3.5: Run tests — confirm green
- [ ] T3.6: Wire trace analysis into maina pr — background run
- [ ] T3.7: Run full test suite — confirm 0 failures
- [ ] T3.8: maina verify + maina commit — commit Phase 3

### Finalize
- [ ] T4.1: Export new modules from packages/core/src/index.ts
- [ ] T4.2: Update IMPLEMENTATION_PLAN.md Sprint 11
- [ ] T4.3: Update roadmap docs
- [ ] T4.4: maina verify — final verification
- [ ] T4.5: maina review — comprehensive review
- [ ] T4.6: Fix any review findings
- [ ] T4.7: maina commit — final commit
- [ ] T4.8: maina pr — create PR with verification proof

## Dependencies

Phase 0 blocks all other phases.
Phase 1 blocks Phase 2 (AI review layers on deterministic checks).
Phase 2 blocks Phase 3 (RL needs full pipeline to generate traces).
Finalize runs after all phases complete.

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Finalize
```

## Definition of Done

- [ ] All tests pass (0 failures)
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] maina analyze shows no errors
- [ ] maina verify on fresh project (no external tools) produces meaningful findings
- [ ] "0 tools available" shows warning, not false pass
- [ ] maina verify --deep runs standard-tier AI review
- [ ] maina init configures Biome automatically
- [ ] maina design outputs HLD/LLD alongside ADR
- [ ] maina spec --auto and maina design --auto work without interaction
- [ ] Post-workflow RL trace analysis runs automatically
