# Task Breakdown

## Tasks

Each task should be completable in one commit. Test tasks precede implementation tasks.

### Phase 1: Structured output
- [ ] T1.1: Create cli/src/json.ts — formatJson() + exit code mapping
- [ ] T1.2: Add --json to maina verify
- [ ] T1.3: Add --json to maina commit
- [ ] T1.4: Add --json to review, stats, context, doctor, slop, analyze
- [ ] T1.5: Implement exit codes in cli/src/index.ts
- [ ] T1.6: Write tests for --json and exit codes
- [ ] T1.7: maina verify + maina commit

### Phase 2: CI integration
- [ ] T2.1: Create .github/actions/verify/action.yml
- [ ] T2.2: Action runs maina verify --json, posts PR comment
- [ ] T2.3: Test action in sample workflow
- [ ] T2.4: maina verify + maina commit

### Phase 3: Language expansion
- [ ] T3.1: Write failing tests for PHP profile
- [ ] T3.2: Add PHP profile + detection
- [ ] T3.3: Write failing tests for per-file detection
- [ ] T3.4: Implement detectFileLanguage()
- [ ] T3.5: Update pipeline for per-file routing
- [ ] T3.6: Run tests
- [ ] T3.7: maina verify + maina commit

### Phase 4: New tools
- [ ] T4.1: Write failing tests for ZAP
- [ ] T4.2: Implement verify/zap.ts
- [ ] T4.3: Write failing tests for Lighthouse
- [ ] T4.4: Implement verify/lighthouse.ts
- [ ] T4.5: Register in pipeline + detect.ts
- [ ] T4.6: Run tests
- [ ] T4.7: Export new modules
- [ ] T4.8: maina verify + maina commit

### Finalize
- [ ] T5.1: Full test suite — 0 failures
- [ ] T5.2: maina review
- [ ] T5.3: Fix findings
- [ ] T5.4: Update docs
- [ ] T5.5: maina commit
- [ ] T5.6: maina pr

## Dependencies

```
Phase 1 (--json, exit codes) → Phase 2 (CI Action needs --json)
Phase 1 → Phase 3 (per-file detection independent, but builds on Phase 1 commit)
Phase 3 → Phase 4 (new tools follow same patterns)
Finalize after all phases
```

## Definition of Done

- [ ] All tests pass (0 failures)
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] maina analyze shows no errors
- [ ] maina verify --json outputs valid JSON
- [ ] Exit codes 0/1/2/3 work correctly
- [ ] GitHub Action works in sample repo
- [ ] PHP profile detects and runs PHPStan
- [ ] Per-file detection works in polyglot repos
- [ ] ZAP and Lighthouse skip gracefully when not installed
