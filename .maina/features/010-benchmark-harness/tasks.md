# Task Breakdown

## Tasks

### Part A: Story Format + Loader

- [ ] Task 1: Create mitt story config, spec, and adapted bun:test ground-truth tests (AC-3, AC-4, AC-5, AC-8)
- [ ] Task 2: Write failing tests for story loader — load config, validate, list available stories (AC-3, AC-7)
- [ ] Task 3: Implement story loader — read story.json, spec.md, test files from stories directory (AC-3, AC-7)

### Part B: Pipeline Runner + Metrics

- [ ] Task 4: Write failing tests for benchmark runner — run bun test in temp dir, capture tokens time test results findings (AC-1, AC-2)
- [ ] Task 5: Implement benchmark runner — isolated temp dir execution, metrics capture with wall-clock time and test pass/fail counts (AC-1, AC-2)

### Part C: Reporter

- [ ] Task 6: Write failing tests for comparison reporter — JSON report and side-by-side terminal table with all metrics (AC-6)
- [ ] Task 7: Implement comparison reporter — generate JSON report and formatted terminal comparison table (AC-6)

### Part D: CLI + Integration

- [ ] Task 8: Write failing tests for benchmark CLI command with --story and --list flags (AC-1, AC-7)
- [ ] Task 9: Implement benchmarkCommand() — --story runs benchmark, --list shows available stories (AC-1, AC-7)
- [ ] Task 10: Export benchmark types and runner functions from core/index.ts (AC-1)
- [ ] Task 11: Run maina verify to check spec quality score and fix findings (AC-8)
- [ ] Task 12: Run maina analyze to verify spec-plan consistency and quality baseline (AC-8)

## Dependencies

- Tasks 2-3 depend on Task 1 (story files needed)
- Tasks 4-5 depend on Task 3 (loader needed for runner)
- Tasks 6-7 depend on Task 5 (runner needed for reporter)
- Tasks 8-9 depend on Tasks 3, 5, 7 (all components needed for CLI)
- Task 10 depends on Tasks 3, 5, 7
- Tasks 11-12 depend on all others

## Definition of Done

- [ ] All tests pass
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] maina analyze shows no errors
- [ ] `maina benchmark --list` shows mitt story
- [ ] `maina benchmark --story mitt` runs and produces a report
- [ ] Mitt ground-truth tests validate against a correct implementation
