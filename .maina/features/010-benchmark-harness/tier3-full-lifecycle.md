# Tier 3 Full Lifecycle Benchmark — Execution Plan

## Goal
Run both pipelines through the COMPLETE 9-step lifecycle on the validator story.
Each starts from scratch in an isolated worktree. Per-step timing captured.

## Maina Pipeline (9 steps)

Each step uses `bun packages/cli/dist/index.js <command>`:

1. **init** — `maina init` in fresh worktree (scaffolds .maina/)
2. **plan** — `maina plan` (creates feature branch + plan.md from requirements)
3. **spec** — `maina spec` (generates test stubs from plan)
4. **design** — `maina design` (proposes approaches → ADR)
5. **implement** — Write validator.ts to pass training tests
6. **verify** — `maina verify` (syntax + linters + slop + security)
7. **review** — `maina review` (two-stage: spec compliance + code quality)
8. **commit** — `maina commit` (verification gate + AI commit message)
9. **pr** — `maina pr` (two-stage PR review + create PR)

## Spec Kit Pipeline (9 steps)

Simulates Claude Code + Superpowers workflow (no maina tools):

1. **init** — Create .specify/ directory structure manually
2. **specify** — Write specification document from requirements
3. **plan** — Write technical plan from specification
4. **tasks** — Break plan into implementation tasks
5. **implement** — Write validator.ts to pass training tests
6. **review** — Self-review the code (no external tools)
7. **commit** — `git commit` with manually written message
8. **pr** — `gh pr create` with manual summary
9. **cleanup** — N/A (no verification artifacts)

## Metrics per step

```json
{
  "step": "name",
  "durationMs": 0,
  "tokensInput": 0,
  "tokensOutput": 0,
  "artifacts": [],
  "notes": ""
}
```

## After both pipelines complete

1. Run training tests (34) against both implementations
2. Run hidden validation tests (95) against both implementations
3. Compare: training pass rate, validation pass rate, total time, LOC, bugs
4. Write results-tier3-full.json and update the report

## Key difference from previous tier 3 run
- Previous: only ran implement → test → verify → review (4-5 steps)
- This run: full 9-step lifecycle from init to PR
- This tests the PLANNING and DOCUMENTATION quality, not just implementation
