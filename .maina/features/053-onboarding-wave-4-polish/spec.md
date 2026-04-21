# Feature: Onboarding-60s Wave 4 — path hygiene + help polish + E2E matrix

> WHAT and WHY only. HOW lives in `plan.md`.

## Problem Statement

The 2026-04-20 dogfood surfaced 13 onboarding gaps. Waves 1–3 closed
eight of them. Wave 4 closes the remaining path-and-surface complaints
before the `bunx @mainahq/cli setup` hero command goes into the landing
page:

- **G8 — `maina context` dumps `CONTEXT.md` at the repo root** and
  every user had to `.gitignore` it. Agents look for it in `.maina/`
  anyway.
- **G9 — `wiki init` blocks the terminal for 20–90s.** New users
  assume the wizard is hung and Ctrl-C half way through.
- **G11 — `maina --help` shows 25 commands** including internal
  plumbing (`analyze`, `benchmark`, `cache`, `explain`, `stats`,
  `sync`, `team`, `visual`, …). First-time users cannot find the
  workflow commands in the wall of text.
- **Latent — `createFeatureDir(mainaDir, …)`** builds
  `<mainaDir>/.maina/features/…`. The parameter name suggests
  `mainaDir` is `<repo>/.maina/`; if any future caller passes
  that literal, the path collapses to `<repo>/.maina/.maina/features/`.
  No caller is broken today but the foot-gun is there.
- **Missing — no E2E onboarding coverage in CI.** Waves 1–3 shipped
  with unit tests only; a regression that breaks `bunx setup`
  end-to-end on a real Docker image would not be caught until a user
  reports it.
- **Missing — hand-typed command counts.** README advertises
  "10 MCP tools", "8 skills", ".mdx files say 24 commands"; every
  release the counts drift. No build-time check enforces truth.

## Target User

- Primary: **Developer running `bunx @mainahq/cli@latest setup` for
  the first time.** They expect `.maina/` to contain maina's state
  and help output to show only commands they might type.
- Secondary: **CI engineer owning the release pipeline.** Needs a
  regression guard that fails the build when onboarding drifts or
  docs lie about counts.

## User Stories

- As a new user, I run `maina context` and the file appears in
  `.maina/CONTEXT.md` so my repo root stays clean.
- As a new user, I run `maina wiki init --background` and the
  terminal returns in under a second. `maina wiki status` tells me
  the wiki is 42% compiled with ETA 18s.
- As a new user, I type `maina --help` and see 13 user-facing
  commands grouped by Workflow / Build & Verify / Wiki / Setup —
  not 25 including `sync`, `team`, `visual`.
- As a release engineer, I push a PR that bumps the MCP tool count.
  CI fails because README.md still says "10 MCP tools". I update the
  badge and the PR passes.
- As a maintainer, I merge a Wave-5 PR that adds a new language.
  `.github/workflows/onboarding-e2e.yml` runs the full 4×2 matrix
  and proves `install.sh` + `maina setup --yes` + an MCP call still
  lands in <60s on a fresh Docker image.

## Success Criteria

- [ ] `maina context` writes `.maina/CONTEXT.md` by default; `--output
      path/to/file.md` overrides; existing `<repo>/CONTEXT.md` is
      preserved unless `--force` is passed.
- [ ] `maina wiki init --background` returns the terminal in <1s;
      progress is written to `.maina/wiki/.progress.json`.
- [ ] `maina wiki status` shows percent-complete and ETA when a
      compile is in flight; falls back to the existing dashboard
      when the wiki is idle.
- [ ] `maina --help` hides `analyze`, `benchmark`, `cache`, `context`,
      `explain`, `feedback`, `learn`, `prompt`, `stats`, `status`,
      `sync`, `team`, `visual`. The `configure` deprecation banner is
      preserved.
- [ ] `scripts/check-paths.ts` fails the build if any source file
      contains `join(.*\.maina.*\.maina.*)` (regression guard for
      G13's double-`.maina` foot-gun).
- [ ] `scripts/docs-manifest.ts` emits a JSON manifest of commands
      + MCP tools + skills. CI greps README.md (and `docs/*.md`) for
      hand-typed `"24 commands"`, `"10 MCP tools"`, `"8 skills"` and
      fails the build if any are present.
- [ ] `.github/workflows/onboarding-e2e.yml` runs a
      `{ide:[claude-code,cursor], lang:[ts,py,go,rust]}` matrix.
      Claude Code + TypeScript is marked `must-pass`; remaining
      cells are `continue-on-error`. Each cell asserts file
      placement + constitution sections + wall time <60s and emits
      its time-to-first-green to `docs/e2e-latency.json`.
- [ ] `bun run e2e:onboarding` runs one cell locally
      (Claude Code + TypeScript) for dev ergonomics.

## Scope

### In Scope

- Default path change for `maina context`.
- `--background` flag on `maina wiki init` + progress file.
- `maina wiki status` progress rendering.
- `maina setup` post-scaffold wiki kick-off (MINIMAL — one line).
- Internal-command hiding via `.hidden()`.
- `scripts/check-paths.ts` regression guard.
- `scripts/docs-manifest.ts` SSOT + CI count check.
- `.github/workflows/onboarding-e2e.yml` 4×2 matrix + fixtures +
  agent simulator.
- `README.md` — replace hand-typed counts with a pointer to
  `bun run docs:manifest`.
- New tests in `packages/cli/src/__tests__/` and
  `packages/cli/src/commands/__tests__/`.

### Out of Scope

- Any edit to `resolve-ai.ts`, `adopt.ts`, `scan/*`, `confirm.ts`,
  `tailor.ts`, `packages/core/src/bootstrap/`,
  `packages/core/src/setup/agent-files/` or the templates — Waves
  2 & 3 own those files; we coordinate via merge, not by editing.
- `install.sh` — Wave 1.
- `packages/cli/src/commands/doctor.ts` — Wave 1.
- `packages/mcp/src/` — Wave 3 owns progressive handshake polish.
- Replacing `CONTEXT.md` with a rich UI or rewriting context
  assembly. Pure path hygiene.
- New MCP tools or skills. The manifest *counts* what exists; it
  does not add anything.

## Design Decisions

- **Default path `.maina/CONTEXT.md`, not repo root.** Matches where
  every other maina artefact lives. Existing root `CONTEXT.md` is
  left alone unless `--force` is passed — we do not yank a file
  users may have cached in their editor.
- **Backgrounded wiki init via fork, not worker thread.** The
  compile already runs in a single-shot Bun process; `Bun.spawn`
  + detach is enough and keeps the parent exit clean. A progress
  file at `.maina/wiki/.progress.json` lets `wiki status` poll
  without an IPC channel.
- **`.hidden()` not `--help`-customisation.** Commander's
  `.hidden()` removes commands from `--help` but keeps them
  callable. That means existing scripts that invoke `maina sync`
  or `maina stats` do not break — they just stop advertising.
- **Counts SSOT via build-time script, not runtime introspection.**
  `scripts/docs-manifest.ts` greps program.ts / server.ts / the
  `packages/skills/*/SKILL.md` filesystem and emits JSON. CI check
  is a regex grep on README.md + docs/. Runtime introspection would
  require loading the CLI at docs-build time and breaks SSR.
- **E2E matrix has one MUST-PASS cell.** Claude Code + TypeScript
  is our golden path; the other 7 cells are informational
  (`continue-on-error: true`) so flakes in rust-on-alpine do not
  block releases. Time-to-first-green is emitted to
  `docs/e2e-latency.json` so the landing page can render a live
  budget chart later.

## Open Questions

- None. Scope is tightly constrained to the 3 gaps + the doc-count
  SSOT + the E2E matrix. Setup.ts is touched MINIMALLY; conflicts
  with Waves 2 & 3 are expected and will be resolved at merge time,
  not pre-emptively.
