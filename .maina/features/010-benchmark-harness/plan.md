# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

The benchmark harness has three layers:

1. **Story loader** — reads story.json + spec.md + tests/ from `.maina/benchmarks/stories/<name>/`
2. **Pipeline runner** — executes maina workflow (spec → plan → implement → verify → test) in an isolated temp directory, capturing metrics
3. **Reporter** — compares metrics from both pipeline runs and outputs JSON + terminal table

**Integration points:**
- New `benchmarkAction()` in `packages/cli/src/commands/benchmark.ts`
- New `packages/core/src/benchmark/` module for runner + reporter
- Story configs in `.maina/benchmarks/stories/`
- `benchmarkCommand()` registered in CLI entrypoint

## Key Technical Decisions

- **Isolated temp dirs**: Each pipeline run gets a fresh temp directory with only the story spec and test files. No cross-contamination.
- **Metrics via wrapper**: Time captured with `performance.now()`. Token counts parsed from AI response metadata. Test results parsed from `bun test` stdout.
- **Story format**: `story.json` has `{ name, description, tier, source, testFramework, testFiles }`. `spec.md` is the natural-language requirements. `tests/` has bun:test-adapted test files.
- **Maina pipeline**: Automated — harness calls `generateSpecQuestions()`, `generateTestStubs()`, then runs `bun test` against ground-truth tests.
- **Spec Kit pipeline**: Manual — harness creates the workspace, user runs Spec Kit CLI, harness reads output and runs tests.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/benchmark/runner.ts` | Pipeline runner — executes workflow in temp dir, captures metrics | New |
| `packages/core/src/benchmark/reporter.ts` | Comparison reporter — JSON + terminal output | New |
| `packages/core/src/benchmark/types.ts` | Shared types (StoryConfig, BenchmarkMetrics, ComparisonReport) | New |
| `packages/core/src/benchmark/story-loader.ts` | Load and validate story.json + spec + tests | New |
| `packages/core/src/index.ts` | Export benchmark types and functions | Modified |
| `packages/cli/src/commands/benchmark.ts` | CLI command (--story, --list) | New |
| `.maina/benchmarks/stories/mitt/story.json` | Mitt story config | New |
| `.maina/benchmarks/stories/mitt/spec.md` | Mitt requirements spec | New |
| `.maina/benchmarks/stories/mitt/tests/mitt.test.ts` | Mitt ground-truth tests (bun:test) | New |

## Tasks

TDD: every implementation task must have a preceding test task.

### Part A: Story Format + Loader

- [ ] Task 1: Create mitt story config, spec, and adapted tests (AC-3, AC-4, AC-5, AC-8)
- [ ] Task 2: Write failing tests for story loader — load story.json config, validate self-contained story directories, list available benchmark stories (AC-3, AC-7)
- [ ] Task 3: Implement story loader in `core/benchmark/story-loader.ts` (AC-3, AC-7)

### Part B: Pipeline Runner + Metrics

- [ ] Task 4: Write failing tests for benchmark runner — run tests in temp dir, capture metrics (AC-1, AC-2)
- [ ] Task 5: Implement benchmark runner in `core/benchmark/runner.ts` — isolated execution, metrics capture (AC-1, AC-2)

### Part C: Reporter

- [ ] Task 6: Write failing tests for comparison reporter — JSON output, side-by-side table (AC-6)
- [ ] Task 7: Implement reporter in `core/benchmark/reporter.ts` (AC-6)

### Part D: CLI + Integration

- [ ] Task 8: Write failing tests for benchmark CLI command (AC-1, AC-7)
- [ ] Task 9: Implement `benchmarkCommand()` with --story and --list flags (AC-1, AC-7)
- [ ] Task 10: Export benchmark types and runner for `maina benchmark --story` JSON report generation (AC-1, AC-6)
- [ ] Task 11: Run maina verify, fix findings (AC-8)
- [ ] Task 12: Run maina analyze for consistency (AC-8)

## Failure Modes

- **Story not found**: Return Result error with available story names.
- **Tests fail to parse**: Log warning, return raw bun test output.
- **AI not available**: Skip AI-dependent metrics (token counts), still run tests.
- **Temp dir cleanup fails**: Use try/catch, don't block report generation.

## Testing Strategy

- **Unit tests** for story loader — valid/invalid configs, missing files
- **Unit tests** for runner — mock Bun.spawn, verify metrics parsing
- **Unit tests** for reporter — verify JSON structure, table formatting
- **Integration test** — run mitt story through maina pipeline, verify report structure
