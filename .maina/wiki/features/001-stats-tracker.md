# Feature: Implementation Plan

## Spec Assertions

- [ ] Record a commit snapshot with timing, token, cache, and quality stats after every successful maina commit via recordSnapshot in commitAction
- [ ] Implement maina stats command showing last commit stats, rolling averages, and trend arrows
- [ ] Support maina stats --json to output raw commit snapshots as JSON
- [ ] Support maina stats --last N to limit displayed commits
- [ ] Compute trends comparing recent N vs previous N commits with directional indicators via getTrends
- [ ] Add commit_snapshots Drizzle schema to the database
- [ ] Stats recording wrapped in try/catch so it never blocks a commit
- [ ] Implement tracker with recordSnapshot, getStats, getLatest, getTrends functions

## Tasks

Progress: 0/6 (0%)

- [ ] T001: Add `commit_snapshots` Drizzle schema to `packages/core/src/db/schema.ts`
- [ ] T002: Write tests for `tracker.ts` — `recordSnapshot`, `getStats`, `getLatest`, `getTrends`
- [ ] T003: Implement `packages/core/src/stats/tracker.ts` with all four functions
- [ ] T004: Write tests for `maina stats` CLI command — default output, `--json`, `--last N`
- [ ] T005: Implement `packages/cli/src/commands/stats.ts` and register in `program.ts`
- [ ] T006: Integrate `recordSnapshot()` into `commitAction()` in commit.ts — capture timing, pipeline result, cache stats

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
