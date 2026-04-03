# Feature: Benchmark Harness — Spec Kit vs Maina

## Problem Statement

There is no objective way to compare spec-driven development tools. Both GitHub Spec Kit and maina claim to improve AI-assisted coding, but without controlled experiments using the same input stories and ground-truth test suites, the comparison is anecdotal. We need a reusable harness that runs the same product story through both pipelines and produces a quantitative comparison report.

## Target User

- Primary: maina developers who need to prove maina's value with hard numbers
- Secondary: anyone evaluating spec-driven development tools

## User Stories

- As a developer, I want to run `maina benchmark --story mitt` so that both Spec Kit and maina implement the same library from the same spec, and I get a comparison report.
- As a developer, I want to add new benchmark stories by dropping a story config into a directory, without modifying harness code.
- As a developer, I want the benchmark to use the library's original test suite as ground truth, so results are objective.

## Success Criteria

- [ ] AC-1: `maina benchmark --story <name>` runs a story through both pipelines and produces a JSON report
- [ ] AC-2: Each pipeline run captures: tokens used (input+output), wall-clock time, test pass/fail counts, verification findings, spec quality score
- [ ] AC-3: Stories are self-contained directories under `.maina/benchmarks/stories/` with a `story.json` config
- [ ] AC-4: The harness clones the original library's test suite into a temp directory for ground-truth validation
- [ ] AC-5: Both pipelines get identical input: the story spec (natural language requirements) and the test file(s)
- [ ] AC-6: The report includes a side-by-side comparison table (maina vs spec-kit) with all metrics
- [ ] AC-7: `maina benchmark --list` shows available stories
- [ ] AC-8: The mitt story passes as the tier-1 benchmark with both pipelines producing runnable implementations

## Scope

### In Scope

- Benchmark harness CLI command (`maina benchmark`)
- Story format (story.json + spec.md + tests/)
- Maina pipeline runner (spec → plan → implement → verify → test)
- Spec Kit pipeline runner (specify → plan → tasks → implement → test)
- Metrics collection (tokens, time, test results, findings, spec score)
- JSON + terminal comparison report
- Tier 1 story: mitt event emitter

### Out of Scope

- Running Spec Kit automatically (requires separate installation — harness records metrics from manual runs)
- Generating library code automatically
- CI integration
- Web dashboard for results

## Design Decisions

- **Manual Spec Kit runs, automated metric capture**: Spec Kit requires its own CLI (`@spec-kit/cli`). The harness provides the story spec and test suite, the user runs each pipeline manually, and the harness collects results from both output directories.
- **Story directories are self-contained**: Each story has `story.json` (metadata), `spec.md` (requirements in natural language), and `tests/` (original test suite adapted for bun:test). No external dependencies.
- **Tests adapted to bun:test**: Original test suites (Mocha/Jest/etc.) are manually ported to bun:test format once per story. This removes test framework as a variable.
- **Metrics collected via wrapper**: The harness wraps each pipeline run, capturing start/end time, token counts from AI responses, and test results from bun test output.
- **Iterative learning**: After each tier, analyze results, identify what to improve in the harness, then run the next tier. This is baked into the workflow, not the tool.

## Open Questions

- None for tier 1. Spec Kit integration details will be refined after the first manual run.
