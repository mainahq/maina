# Feature 050: Onboarding-60s — Wave 1

**Issue:** https://github.com/mainahq/maina/issues/213
**Parent spec:** `MAINA-ONBOARDING-SPEC.md` (draft, session 2026-04-21)
**Wave scope:** install path + doctor global MCP + degraded honesty. Waves 2–4 are follow-ups.

## Problem Statement

The onboarding promise — "one command, <60s, AI assistant wired with maina on PATH" — does not hold on 2026-04-20 dogfooding. Wave 1 closes the four gaps that make a first run feel broken even before any constitution work lands:

- **G1.** `bunx @mainahq/cli@latest setup` succeeds but `maina` is not on PATH in the shell Claude Code spawns. `install.sh` does not fail loudly when the global install step is skipped.
- **G4.** Setup declares "AI degraded" on a plain TypeScript repo that Claude Code could host. `resolveSetupAI` stores `reason` internally but never shows it, so the banner looks arbitrary.
- **G5.** `maina doctor` reports `missing (Claude Code)` without a single command the user can copy to fix it.
- **G10.** `maina doctor` ignores global MCP registrations in `~/.claude/settings.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.config/zed/settings.json` — so users who registered maina at user scope see false-negative "missing" reports.

If we ship further waves on top of this, every downstream fix will be diagnosed by users as "still broken" because the install/doctor/degraded surfaces will continue to lie.

## Target User

- **Primary:** A developer opening Claude Code on an existing TypeScript repo who runs the install one-liner. They have no OpenRouter key, no Maina account. They expect the AI agent in their IDE to find `maina` and give them one honest status screen.
- **Secondary:** A developer who previously ran `claude mcp add maina` at user scope (`~/.claude/settings.json`) and now wonders why `maina doctor` in a new repo claims the MCP is missing.

## User Stories

- As a first-run user, I want the install one-liner to exit non-zero with a copy-pasteable fix if `maina` is not on PATH after it finishes, so I am never lied to about success.
- As a user running `maina setup` inside Claude Code, I want the host model used for constitution generation automatically — not a silent fall-through to a degraded offline template — and if I *am* degraded, I want the reason and the single command that recovers me.
- As a user running `maina doctor`, I want every `missing` row paired with the exact command to fix it, and I want `--fix` to run those commands with my confirmation.
- As a user with a user-scope MCP registration, I want doctor to recognise it rather than telling me to re-register.

## Success Criteria

Binary and test-enforced. Each maps to a test ID in `plan.md` §3.

- [ ] **6.1 Install & PATH** — `install.sh` exits non-zero with remediation if `command -v maina` fails after global install. No silent bunx fallback. Post-install, a freshly-spawned shell resolves `which maina` in <50 ms. `README.md` hero shows `curl … | bash` first; `bunx` demoted to an Alternates disclosure. `bunx @mainahq/cli setup` self-upgrades to global or errors loudly with one-command remediation.
- [ ] **6.3 Degraded honesty** — `resolveSetupAI` reason (`host_unavailable` / `rate_limited` / `byok_failed` / `no_key`) is surfaced in the terminal AND written to `.maina/setup.log`. When `process.env.CLAUDE_CODE` is set or `~/.claude/` exists, setup prefers host delegation and does not degrade for host availability alone. The degraded banner always prints a one-command recovery line matching the reason; it never appears without a printed reason.
- [ ] **6.4 Doctor** — `checkMcpHealth` reads `~/.claude/settings.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.config/zed/settings.json` in addition to project-local files. Every `missing` row prints a copy-pasteable fix command. `maina doctor --fix` executes the printed commands in sequence with user confirmation. `maina doctor --json` returns `{tools,mcp,errors}` for CI consumption.

## Scope

### In Scope (Wave 1)

- `install.sh` — exit-code-shaped hardening, PATH verification, shell-profile hint, bunx self-upgrade branch.
- `README.md` — hero block swap (curl primary, alternates disclosure). Command-count claim left untouched in this wave (Wave 4 W8 owns SSOT regen).
- `packages/core/src/mcp/clients.ts` — new global-readers for Claude Code, Cursor, Windsurf, Zed MCP configs.
- `packages/cli/src/commands/doctor.ts` — scope labelling (`project`/`global`/`both`/`missing`), per-row `fix` string, `--fix` interactive executor, `--json` output.
- `packages/core/src/setup/resolve-ai.ts` — surface `reason` to the setup emitter; prefer host when `CLAUDE_CODE` env or `~/.claude/` present; generic template unchanged by this wave (Wave 2 W4 owns constitution content).
- `packages/cli/src/commands/setup.ts` — write `.maina/setup.log` on degraded fall; print reason + `recoveryCommand(reason)` line.
- New tests (TDD): see `plan.md` §3.

### Out of Scope (explicitly defer)

- **W4** constitution derivation — adopt/scan/confirm/tailor pipeline, Maina Workflow / File Layout sections, `buildGenericConstitution` content. **Wave 2.**
- **W5** bootstrap merge of `init` and `setup` scaffolding code paths. **Wave 3.**
- **W6** IDE wiring — `.claude/settings.json` keyed merge, managed regions in JSON, progressive MCP handshake. **Wave 3.**
- **W7** path hygiene — `maina context` default under `.maina/`, `wiki init --background` seed, `createFeatureDir` double-`.maina` regression check. **Wave 4.**
- **W8** command surface cleanup + SSOT doc-count regen. **Wave 4.**
- **W9** E2E onboarding matrix in CI. **Wave 4.**
- Cloud account / billing flows, `maina learn` evolve loop, skills deployment model decision.
- Rewriting Context / Prompt / Verify engines, Drizzle schemas, public MCP tool surface.

## Design Decisions

Key choices. Tradeoffs captured so the reviewer can challenge them.

- **Worktree off master, not on top of `feature/052-wiki-lint-fixes`.** Chosen because 052 owns PR #212 with an unrelated title ("wiki-lint accuracy") and 438 dirty files. Alternative — commit onboarding work on top — was rejected because it would pollute #212 and make review unreadable.
- **Wave 1 scope stops before the constitution work.** Chosen because honest degraded reporting and a working doctor are prerequisites to validating Wave 2's golden-master tests — without them, "constitution didn't adopt my AGENTS.md" is indistinguishable from "setup silently degraded." Alternative — bundle W3 with W4 — was rejected on test-legibility grounds.
- **Install script keeps `curl … | bash` as primary, demotes `bunx`.** Chosen per PDF Package Reference + spec Principle 1. Alternative — keep bunx-first because bunx avoids a global write — was rejected because the failure mode (PATH miss) is invisible to the AI that spawns a subshell.
- **Doctor `--fix` is interactive-only by default.** Chosen because `--fix` writes to user-global config files; running unattended would violate the "non-destructive everywhere" principle. `--yes` flag reserved for future CI use.
- **`recoveryCommand(reason)` is a table, not an LLM call.** Chosen because the recovery set is small and finite (4 reasons) and user-visible text must be deterministic. Alternative — ask the AI to write a recovery line — was rejected as unnecessary model dependency.
- **Tests use stubbed `$HOME` via `HOME=…` env, not mocked fs.** Chosen because the production code reads via `os.homedir()`; env override is the smallest-surface fake. Alternative — inject a `fs` interface — was rejected as over-engineering for Wave 1.

## Open Questions

None blocking. Tracked for waves 2+:

- Skills-on-disk vs MCP-served (spec §9 Q1) — Wave 3 decision.
- Claude Code host-tier delegation API surface (spec §9 Q4) — parallel investigation, affects Wave 2 tailor call.
- Wiki seed depth and progress surface (spec §9 Q5) — Wave 4.
