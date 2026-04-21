# Feature 050: Onboarding-60s — Wave 1 Plan (HOW)

> HOW only — see `spec.md` for WHAT and WHY.

**Issue:** https://github.com/mainahq/maina/issues/213
**Convention:** TDD — test first, watch fail, implement, watch pass. `Result<T, E>`, no throws, no `console.log`.

## 1. Workstreams

### W1. Install hardening & canonical path (closes G1)

Files:

- `install.sh` (lines 460–472 currently): distinct exit codes, shell-profile hint, no silent bunx fallback.
- `README.md` (hero block only this wave): `curl … | bash` first, `bunx`/`bun add -g` under an Alternates disclosure. Command-count SSOT regen is deferred to Wave 4 W8.
- `packages/cli/src/commands/setup.ts` (entry block): if invoked via `bunx` and no global `maina` is on PATH, print the install-globally notice and exec global install, or exit 1 with a one-command remediation.

Exit codes from `install.sh`:

- `0` — `maina` on PATH.
- `10` — No package manager found (bun/npm/pnpm/yarn all missing). Remediation: `curl -fsSL https://bun.sh/install | bash`.
- `11` — The package manager's global install command failed. Remediation: `npm install -g @mainahq/cli`.
- `12` — Global install succeeded but PATH not refreshed. Remediation: print the shell-profile export line for the detected package manager's global bin directory.

Contract: `install.sh` must never exit 0 if `command -v maina` is still empty. The existing fallback branch at lines 462–469 (silent pivot to `$runner @mainahq/cli`) goes away.

### W2. Doctor — global MCP + per-row remediation (closes G5, G10)

Files:

- `packages/core/src/mcp/clients.ts` — already exposes `globalConfigPath` per client. Add a small reader helper `readMainaRegistration(info, homeOverride?)` that parses the config and returns `{ present: boolean; scope: "global" | "none"; path: string }`.
- `packages/cli/src/commands/doctor.ts` — rewrite `checkMcpHealth` to:
  - iterate `buildClientRegistry(homeOverride)` plus project-local `.mcp.json` and `.claude/settings.json`;
  - per IDE, compute `scope ∈ {project, global, both, missing}`;
  - for every `missing` row, attach a `fix` string: the exact CLI command to register (e.g. `maina mcp add --client claude --scope global`);
  - extend the returned shape to `McpIntegration[]` (array, not the flat-four today).
- `packages/cli/src/commands/doctor.ts` — new `--fix` flag: iterate the missing rows, print each `fix` command, confirm via `@clack/prompts`, exec via DI'd `execFn` for tests.
- `packages/cli/src/commands/doctor.ts` — `--json` already exists at command level. Update the emitted shape to include `mcp.integrations[]` so CI can assert on scope + fix.

Contract: no `missing` row without a `fix` string. `--fix` is interactive by default; `--yes` reserved for later.

### W3. Honest degraded messaging (closes G4)

Files:

- `packages/core/src/setup/resolve-ai.ts`:
  - Keep existing tier order (host → cloud → byok → degraded). Already returns `metadata.reason`.
  - Normalise reason values to the union `"host_unavailable" | "rate_limited" | "byok_failed" | "no_key" | "ai_unavailable" | "forced"`. Existing internals (`"http_{status}"`, `"timeout"`, `"malformed_json"`, `"empty_response"`, `"network_error"`) move to a new optional `metadata.reasonDetail` field.
  - Prefer host tier for the detection surface: already handled by `isHostMode()` in `config/index`. Verify with tests — no new branching expected.
- `packages/cli/src/commands/setup.ts` (around line 789):
  - After `ai.source === "degraded"`, call new helper `recoveryCommand(reason): string` and emit via `deps.log.warn` + `deps.log.info` lines.
  - Append a line to `.maina/setup.log` with `ISO timestamp [degraded] reason=<r> recovery=<cmd>`. File path: `join(cwd, ".maina", "setup.log")`. Create `.maina/` if absent.
- New module `packages/core/src/setup/recovery.ts` exporting `recoveryCommand(reason: SetupDegradedReason): string`. Table-driven, no LLM. Exhaustive switch typed against the union.

Contract:

- Every degraded outcome logs to `.maina/setup.log` AND prints to terminal.
- Reason + recovery command line appears every time the degraded banner appears.
- Inside Claude Code (`CLAUDE_CODE` env set or `~/.claude/` present), host tier is attempted; we never degrade for "host availability alone" — if host returns null, that becomes `host_unavailable` and the reason surfaces to the user.

## 2. Sequencing

- **Parallel-safe:** W1 and W2 and W3 touch disjoint files; no merge ordering required.
- **Test first everywhere.** Each workstream has a failing test committed before any production edit.
- **Worktree discipline:** all work lands on `feature/050-onboarding-60s-wave-1`. Never touch `feature/052-wiki-lint-fixes` in this session.

## 3. Tests (TDD)

| ID | File | Type | Asserts (acceptance row) |
|---|---|---|---|
| T-W1.1 | `packages/cli/src/__tests__/install-path.e2e.test.ts` | E2E (skip if no Docker) | Fresh Alpine: `install.sh` exits 0 on success path, exit 12 when PATH missing. Log contains shell-profile hint on 12. Maps to 6.1 bullets 2–3. |
| T-W1.2 | shellcheck step in existing `bun run check` or new `scripts/check-install-sh.ts` | Static | shellcheck passes for new branches. |
| T-W2.1 | `packages/cli/src/commands/__tests__/doctor.mcp-global.test.ts` | Unit | `$HOME` fixture with only `~/.claude/settings.json` containing `mcpServers.maina` → doctor reports `claude` scope `global`, others `missing` with `fix`. Maps to 6.4 bullet 1. |
| T-W2.2 | `packages/cli/src/commands/__tests__/doctor.fix-command.test.ts` | Unit | Every `missing` row has non-empty `fix` matching `^(maina|claude|cursor|npx|bunx) .+`. Maps to 6.4 bullet 2. |
| T-W2.3 | `packages/cli/src/commands/__tests__/doctor.fix-flag.test.ts` | Unit | DI'd `execFn` captures calls for `doctor --fix --yes`. Maps to 6.4 bullet 3. |
| T-W2.4 | `packages/cli/src/commands/__tests__/doctor.json.test.ts` | Unit | `doctor --json` emits `{mcp: { integrations: [...] }}` with scope + fix. |
| T-W3.1 | `packages/core/src/setup/__tests__/recovery.test.ts` | Unit | `recoveryCommand(r)` non-empty for each union value; exhaustive switch enforced by `ts-expect-error`. Maps to 6.3 bullet 3. |
| T-W3.2 | `packages/core/src/setup/__tests__/resolve-ai.reason-normalised.test.ts` | Unit | `metadata.reason` ∈ normalised union; `metadata.reasonDetail` carries sub-reason. Maps to 6.3 bullet 4. |
| T-W3.3 | `packages/cli/src/commands/__tests__/setup.degraded-log.test.ts` | Unit | `.maina/setup.log` contains `reason=... recovery=...` line. Logger saw recovery. Maps to 6.3 bullets 1–2. |

All `bun:test`. No new framework. Stub `$HOME` via env, not fs mocks.

## 4. TDD sequencing within each workstream

1. Write failing tests.
2. `bun test --filter <path>` → red.
3. Implement minimum to pass.
4. `bun test --filter <path>` → green.
5. `bun run check` + `bun run typecheck`.
6. Commit via `maina commit` (no raw git, per memory `feedback_use_maina_commit`).

## 5. Rollout

Per parent plan §7, Wave 1 lands behind no flag — small, P0, reversible.

1. One commit per workstream (W1, W2, W3 = three commits on the feature branch).
2. Open PR with all three commits. Link to issue #213 and parent spec.
3. Manual verification on a local fresh repo before merging.
4. No flag, no staged rollout.

## 6. What this plan does NOT change

Any of these showing up in the diff is a review-blocker:

- Constitution content (`buildGenericConstitution` untouched — Wave 2 W4 owns it).
- Agent files (`.cursorrules`, `AGENTS.md`, `CLAUDE.md` — Wave 3 W6).
- Bootstrap merge of `init` and `setup` (Wave 3 W5).
- `.maina/features/...` numbering (Wave 4 W7).
- Skills deployment (Wave 3).
- Wiki seed async (Wave 4 W7).
- Help output hiding (Wave 4 W8).

## 7. Budget

W1 (S 1–2d) + W2 (M 2–3d) + W3 (S 1d) = **4–6 engineer-days**.
