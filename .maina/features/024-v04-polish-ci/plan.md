# Implementation Plan — v0.4.0 Polish + CI

> HOW only — see spec.md for WHAT and WHY.

## Architecture

4 phases, each independently shippable. All commands gain `--json` first (foundation), then CI integration, then language expansion, then new tools.

- Pattern: `--json` adds a serialization layer on top of existing Result types. No new data structures needed.
- Integration points: `cli/src/commands/*.ts` (flag), `core/src/language/profile.ts` (PHP), `core/src/verify/pipeline.ts` (per-file routing, new tools)

## Key Technical Decisions

- **--json serializes existing types** — PipelineResult, ReviewResult, etc. already structured. No adapter needed.
- **Exit codes via process.exitCode** — Not process.exit(), allows cleanup handlers to run.
- **ZAP via Docker** — `docker run zaproxy/zap-stable` outputs SARIF. Reuse existing `parseSarif()`.
- **Lighthouse via npm** — `lighthouse` CLI outputs JSON. Parse scores + diagnostics into Finding[].
- **Per-file detection by extension** — Simple, fast, deterministic. Uses existing LanguageProfile.extensions.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/cli/src/json.ts` | Shared JSON output helper | New |
| `packages/cli/src/commands/verify.ts` | --json flag | Modified |
| `packages/cli/src/commands/commit.ts` | --json flag | Modified |
| `packages/cli/src/commands/review.ts` | --json flag | Modified |
| `packages/cli/src/commands/stats.ts` | --json flag | Modified |
| `packages/cli/src/commands/context.ts` | --json flag | Modified |
| `packages/cli/src/commands/doctor.ts` | --json flag | Modified |
| `packages/cli/src/commands/slop.ts` | --json flag | Modified |
| `packages/cli/src/commands/analyze.ts` | --json flag | Modified |
| `packages/cli/src/index.ts` | Exit code mapping | Modified |
| `packages/core/src/language/profile.ts` | PHP profile | Modified |
| `packages/core/src/language/detect.ts` | Per-file detection, PHP markers | Modified |
| `packages/core/src/verify/pipeline.ts` | Per-file language routing | Modified |
| `packages/core/src/verify/zap.ts` | ZAP DAST runner | New |
| `packages/core/src/verify/lighthouse.ts` | Lighthouse runner | New |
| `.github/actions/verify/action.yml` | GitHub Action | New |
| `packages/core/src/index.ts` | Export new modules | Modified |

## Tasks

TDD: every implementation task must have a preceding test task.

### Phase 1: Structured output

- [ ] T1.1: Create `cli/src/json.ts` — `formatJson()` helper + exit code mapping
- [ ] T1.2: Add `--json` flag to `maina verify` — serialize PipelineResult
- [ ] T1.3: Add `--json` flag to `maina commit` — serialize commit result
- [ ] T1.4: Add `--json` flag to `maina review`, `stats`, `context`, `doctor`, `slop`, `analyze`
- [ ] T1.5: Implement exit codes in `cli/src/index.ts` — 0/1/2/3 mapping
- [ ] T1.6: Write tests for --json output and exit codes
- [ ] T1.7: `maina verify` + `maina commit`

### Phase 2: CI integration

- [ ] T2.1: Create `.github/actions/verify/action.yml` — composite action
- [ ] T2.2: Action runs `maina verify --json`, posts results as PR comment
- [ ] T2.3: Test action in a sample workflow
- [ ] T2.4: `maina verify` + `maina commit`

### Phase 3: Language expansion

- [ ] T3.1: Write failing tests for PHP language profile
- [ ] T3.2: Add PHP profile to `language/profile.ts` — PHPStan, Psalm
- [ ] T3.3: Add PHP detection to `language/detect.ts` — composer.json, .php files
- [ ] T3.4: Write failing tests for per-file language detection
- [ ] T3.5: Implement `detectFileLanguage(filePath)` in `language/detect.ts`
- [ ] T3.6: Update `verify/pipeline.ts` — route per-file to correct profile
- [ ] T3.7: Run tests — confirm green
- [ ] T3.8: `maina verify` + `maina commit`

### Phase 4: New tools

- [ ] T4.1: Write failing tests for ZAP integration
- [ ] T4.2: Implement `verify/zap.ts` — Docker runner + SARIF parser
- [ ] T4.3: Write failing tests for Lighthouse integration
- [ ] T4.4: Implement `verify/lighthouse.ts` — CLI runner + JSON parser
- [ ] T4.5: Register ZAP + Lighthouse in pipeline and detect.ts
- [ ] T4.6: Run tests — confirm green
- [ ] T4.7: Export new modules from `core/src/index.ts`
- [ ] T4.8: `maina verify` + `maina commit`

### Finalize

- [ ] T5.1: Run full test suite — confirm 0 failures
- [ ] T5.2: `maina review` — comprehensive review
- [ ] T5.3: Fix review findings
- [ ] T5.4: Update roadmap + IMPLEMENTATION_PLAN.md
- [ ] T5.5: `maina commit` — final commit
- [ ] T5.6: `maina pr` — create PR with verification proof

## Failure Modes

- `--json` on interactive commands (brainstorm, configure) → error: "--json not supported for interactive commands"
- ZAP Docker not available → skip with info note
- Lighthouse not installed → skip with info note
- PHP tools not installed → skip with info note (same as all other language tools)
- Exit code 2 (tool failure) → logged, doesn't mask findings from other tools

## Testing Strategy

- **Unit tests**: JSON formatter, exit code mapping, PHP profile, per-file detection, ZAP/Lighthouse parsers
- **Integration**: `maina verify --json | jq .passed` returns true/false
- **Mocks**: Docker (ZAP), lighthouse CLI, phpstan, psalm
- **Patterns**: Follow existing `describe/it` + `mock.module()` patterns
