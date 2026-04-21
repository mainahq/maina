# Implementation Plan — Wave 4 path hygiene + help polish + E2E matrix

> HOW only. WHAT and WHY live in `spec.md`.

## Architecture

Three orthogonal slices, no shared state.

### Slice W7 — path hygiene (G8, G9, double-`.maina` guard)

1. `packages/cli/src/commands/context.ts`
   - Add `--output <path>` option (string, optional).
   - Add `--force` option (boolean).
   - Default output = `join(mainaDir, "CONTEXT.md")` where
     `mainaDir = join(repoRoot, ".maina")`. `.maina/` is created
     if missing (via `mkdirSync(..., { recursive: true })`).
   - If the legacy `<repoRoot>/CONTEXT.md` exists and
     `options.force !== true`, leave it alone (do not delete) and
     log a one-line hint telling the user it is now obsolete.
   - `--output <path>` overrides the default verbatim (absolute or
     repo-root-relative; we `path.resolve` against cwd).
2. `packages/cli/src/commands/wiki/init.ts`
   - Add `--background` flag + `--depth <quick|full>` flag
     (`quick` maps to existing `sample: true` on `wikiCompileAction`;
     default `full`).
   - When `--background`: spawn the current process with
     `Bun.spawn(["bun", __filename, "wiki", "init", …], { stdio: ... })`
     detached; write an initial `.maina/wiki/.progress.json`
     stub; return immediately.
   - When the background child runs, it inherits the current
     compile path; `compileWiki` already writes to `.state.json`.
     We additionally write `.progress.json` with `{startedAt,
     percent, etaSeconds, stage}` after each major step.
   - Because we do not own the core compile, we wrap it with a
     progress emitter: `onProgress` callback updating the JSON
     file. If the core does not yet support `onProgress`, we fall
     back to a 2-step emitter (`compiling → done`) driven from
     the CLI.
3. `packages/cli/src/commands/wiki/status.ts`
   - On top of existing dashboard, read `.progress.json` if
     present. If `startedAt` is within the last hour and
     `percent < 100`, render a compact progress line
     `Compiling… 42% (ETA 18s)`. Otherwise fall through to the
     existing output.
4. `packages/cli/src/commands/setup.ts`
   - MINIMAL change: after the existing `seedWiki` phase, if the
     wiki was *not* already present and the foreground compile
     was abandoned (`wikiBackgrounded === true`), flip the
     detached flag so the compile continues after setup exits
     rather than being killed with the CLI. This is a 5-line
     edit; no restructuring.
5. `scripts/check-paths.ts`
   - Bun script. Walks `packages/**/src/**/*.ts` (not tests, not
     build output). For each file, runs regex
     `join\([^)]*["']\.maina["'][^)]*["']\.maina["']/` — matches
     any two literal `.maina` arguments in a single `join(…)`
     call. Exits 1 with the file+line if any match. Empty match
     = exit 0.

### Slice W8 — command surface cleanup (G11)

1. `packages/cli/src/program.ts`
   - Call `.hidden()` on the Commander instances returned by
     `analyzeCommand`, `benchmarkCommand`, `cacheCommand`,
     `contextCommand`, `explainCommand`, `feedbackCommand`,
     `learnCommand`, `promptCommand`, `statsCommand`,
     `statusCommand`, `syncCommand`, `teamCommand`, `visualCommand`.
   - The `configure` deprecation banner is preserved (we do NOT
     hide `configure`).
2. `scripts/docs-manifest.ts`
   - Bun script. Outputs JSON `{commands: number, mcpTools: number,
     skills: number, generatedAt: iso}` plus per-entity lists.
   - Commands: parse `program.ts` — count `program.addCommand(`
     lines under "Workflow", "Build & Verify", "Wiki",
     "Setup & Config". We do NOT count the hidden "Internals"
     section.
   - MCP tools: parse `packages/mcp/src/server.ts` —
     `ALL_TOOL_DESCRIPTIONS` array length.
   - Skills: list directories under `packages/skills/` that
     contain a `SKILL.md`.
3. CI check — hand-typed counts
   - In `scripts/docs-manifest.ts` (second mode: `--check`):
     grep `README.md`, `packages/docs/src/content/docs/*.md{,x}`
     for `/\b\d+ (commands|MCP tools|skills)\b/i`. If matches
     found, exit 1 with a pointer to `bun run docs:manifest`.
4. `README.md`
   - Replace the two lines that hand-type "10 MCP tools" /
     "8 cross-platform skills" with a soft-link pointer:
     "Run `bun run docs:manifest` for the live tool + skill
     inventory."
5. `package.json`
   - Add `"docs:manifest": "bun scripts/docs-manifest.ts"`.
   - Add `"docs:check": "bun scripts/docs-manifest.ts --check"`.
   - Add `"check:paths": "bun scripts/check-paths.ts"`.

### Slice W9 — E2E onboarding matrix (§6.11)

1. `ci/e2e/fixtures/`
   - Four tiny fixture repos: `ts/`, `py/`, `go/`, `rust/`.
     Each contains a single source file + package manifest
     (package.json / pyproject.toml / go.mod / Cargo.toml) so
     stack detection fires on a plausibly-realistic repo.
2. `ci/e2e/simulate-agent.ts`
   - Bun script that stands in for Claude Code / Cursor. Spawns
     `maina --mcp`, issues a handshake + `list_tools` + one
     `getContext` call, asserts the envelope shape, exits 0/1.
   - Accepts `--ide <claude-code|cursor>` flag — purely
     declarative for now; both IDEs use the same MCP stdio
     transport so there is no real fork.
3. `.github/workflows/onboarding-e2e.yml`
   - Trigger: `workflow_dispatch`, `schedule: cron: "0 9 * * *"`
     (daily 09:00 UTC), and `pull_request` paths-filter on
     `install.sh`, `packages/cli/src/commands/setup.ts`,
     `packages/cli/src/commands/doctor.ts`, `ci/e2e/**`.
   - Matrix: `ide: [claude-code, cursor]`, `lang: [ts, py, go,
     rust]`, `os: [ubuntu-latest]`.
   - Claude Code + TypeScript cell is `must-pass`: no
     `continue-on-error`. Other cells `continue-on-error: true`
     so flakes do not block merges.
   - Per-cell steps: checkout → install Bun → copy
     `ci/e2e/fixtures/${{matrix.lang}}/` into a scratch dir →
     run `install.sh` → run `maina setup --yes --ci` → run
     `bun ci/e2e/simulate-agent.ts --ide ${{matrix.ide}}` →
     assert `.maina/constitution.md` contains "Maina Workflow"
     + "File Layout" → assert wall time < 60s → emit duration
     to a JSON step-output.
   - Final aggregate step collects all cells' durations and
     writes `docs/e2e-latency.json`.
4. `package.json`
   - Add `"e2e:onboarding": "bun ci/e2e/run-local.ts ts
     claude-code"` (new thin driver that calls the same
     fixture-copy + simulate-agent steps locally).

## Key Technical Decisions

- **`.hidden()` over deletion.** Internal commands stay callable
  so any CI or script that still references them does not break;
  they simply vanish from `--help`. This is non-breaking.
- **Progress file over IPC.** `.maina/wiki/.progress.json` is
  crash-safe, can be read by other tools, and survives a CLI
  restart. An IPC channel would be cleaner but ties the status
  command to a still-running background process.
- **Regex guard, not AST.** `scripts/check-paths.ts` uses a flat
  regex because the foot-gun is a simple literal pattern. An
  AST walker would take 100x longer to build for zero additional
  coverage.
- **E2E matrix as a separate workflow.** Keeps the main CI (lint
  + test) fast. The E2E runs nightly + on setup-scope PRs, not
  on every commit.
- **One must-pass cell.** Matrix flakes (especially Rust + alpine)
  would block releases otherwise. Claude Code + TypeScript is the
  golden path we promise works.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/cli/src/commands/context.ts` | Default to `.maina/CONTEXT.md`, add `--output`/`--force` | Modified |
| `packages/cli/src/commands/wiki/init.ts` | Add `--background` + `--depth` | Modified |
| `packages/cli/src/commands/wiki/status.ts` | Show progress/ETA | Modified |
| `packages/cli/src/commands/setup.ts` | 1-line wiki kickoff tweak | Modified |
| `packages/cli/src/program.ts` | `.hidden()` internal commands | Modified |
| `README.md` | Remove hand-typed counts | Modified |
| `package.json` | 3 new scripts | Modified |
| `scripts/check-paths.ts` | Double-`.maina` regex guard | NEW |
| `scripts/docs-manifest.ts` | SSOT manifest + `--check` | NEW |
| `.github/workflows/onboarding-e2e.yml` | 4×2 E2E matrix | NEW |
| `ci/e2e/fixtures/{ts,py,go,rust}/` | Fixture repos | NEW |
| `ci/e2e/simulate-agent.ts` | MCP-call simulator | NEW |
| `ci/e2e/run-local.ts` | `bun run e2e:onboarding` driver | NEW |
| `packages/cli/src/__tests__/help-output.snapshot.test.ts` | Help excludes internals | NEW |
| `packages/cli/src/commands/__tests__/context.output-path.test.ts` | Default `.maina/CONTEXT.md` | NEW |
| `packages/cli/src/commands/__tests__/wiki-status.test.ts` | Progress rendering | NEW (may merge into wiki.test.ts) |
| `packages/core/src/features/__tests__/numbering.no-double.test.ts` | Regression guard | NEW |

## Tasks

TDD. Test first. Watch fail. Implement. Watch pass.

1. [ ] Write `numbering.no-double.test.ts` — asserts that
       `createFeatureDir(repoRoot, …)` never produces a path
       containing `/.maina/.maina/`. Exercise with a range of
       `repoRoot` values including trailing slash + literal
       `/.maina`.
2. [ ] Write `context.output-path.test.ts` — asserts default
       output = `.maina/CONTEXT.md`, `--output` overrides,
       legacy repo-root `CONTEXT.md` preserved unless `--force`.
3. [ ] Write `help-output.snapshot.test.ts` — parses Commander
       `helpInformation()` and asserts all 13 internals are
       absent while `brainstorm`, `commit`, `setup`, `wiki` are
       present.
4. [ ] Extend `wiki.test.ts` (NOT separate file — tests already
       live there) with two cases:
         - `wiki init --background` returns immediately.
         - `wiki status` renders "Compiling… X%" when
           `.progress.json` exists.
5. [ ] Implement `context.ts` changes; run #2, go green.
6. [ ] Implement `wiki/init.ts` + `wiki/status.ts` changes; run
       #4, go green.
7. [ ] Implement `program.ts` `.hidden()`; run #3, go green.
8. [ ] Implement `setup.ts` MINIMAL change (5-line tweak).
9. [ ] Write `scripts/check-paths.ts`. Verify it flags a
       deliberately broken file, then remove the break.
10. [ ] Write `scripts/docs-manifest.ts` with `--check`. Verify
        it flags a deliberately broken README, then remove.
11. [ ] Update `README.md` to remove hand-typed counts.
12. [ ] Add `package.json` scripts.
13. [ ] Author `ci/e2e/fixtures/` (4 tiny repos).
14. [ ] Author `ci/e2e/simulate-agent.ts` + `ci/e2e/run-local.ts`.
15. [ ] Author `.github/workflows/onboarding-e2e.yml`.
16. [ ] Verify `bun run e2e:onboarding` runs ts+claude-code
        locally.
17. [ ] `bun run check && bun run typecheck && bun run test`
        until green.
18. [ ] `maina verify`.
19. [ ] MCP `reviewCode` + `checkSlop`.
20. [ ] `maina commit` with scope `cli` (wave is primarily `cli`;
        `ci` files are incidental).

## Failure Modes

- **`--background` leaves orphan processes.** If the parent is
  killed before the child's `.progress.json` is complete, the
  compile may keep running. Mitigation: the child writes a
  heartbeat and `wiki status` considers any heartbeat older
  than 10 minutes to be a dead-run (reports "stalled").
- **`.hidden()` breaks a user's muscle memory.** Mitigation:
  commands are still callable, only invisible. If a user types
  `maina analyze` it still works.
- **Fixture repos rot.** Mitigation: fixtures are minimal (1
  source file each); a language's tooling changes are unlikely
  to break one-file projects.
- **E2E runtime exceeds 60s on a cold CI runner.** Mitigation:
  only Claude Code + TypeScript is must-pass; other cells can
  be slow without blocking.
- **Docs-manifest false positive on a legit `N commands` string.**
  Mitigation: the regex requires the unit word
  (`commands`/`MCP tools`/`skills`) to *immediately* follow a
  number; prose like "nine commands are workflow" does not match
  because `nine` is spelled out. If a false positive bites,
  we annotate with `<!-- docs-manifest: ignore -->` (Wave 5
  work).

## Testing Strategy

- Unit tests (bun:test) for each CLI behaviour change.
- Snapshot test for help output (string-based, not JSON).
- Regression test for `createFeatureDir` — asserts the path
  shape is stable.
- `scripts/check-paths.ts` runs in CI via `bun run check:paths`
  as a new step in `.github/workflows/ci.yml`.
- `scripts/docs-manifest.ts --check` runs in CI as
  `bun run docs:check`.
- `.github/workflows/onboarding-e2e.yml` runs on cron + setup-
  scope PRs.
