# Implementation Plan — Feature 053

> HOW only — see spec.md for WHAT and WHY.

## Architecture

A small `bootstrap/` module owns the static parts of the `.maina/` skeleton. Both `init` and `setup` depend on it. Agent-file writers remain in `setup/agent-files/` because they depend on stack context; new `claude.ts` and `cursor.ts` siblings add keyed-JSON-merge helpers for `.claude/settings.json` and `.cursor/mcp.json`. A separate `setup/skills-deploy.ts` materialises SKILL.md files from `@mainahq/skills`.

The MCP server gets two registration paths — progressive (3 + `list_tools`) and `allTools: true` (all 10). Today it already has the shape; the fix is to actually limit which tools get registered in progressive mode instead of registering all 13 and counting on `list_tools` to surface them.

- Pattern: module boundary + result types. No new abstractions.
- Integration points:
  - `packages/core/src/init/index.ts` — `bootstrap()` calls `bootstrap/scaffold` for the shared tree, then continues with stack-specific files.
  - `packages/cli/src/commands/setup.ts` — `setupAction` calls `bootstrap/scaffold`, then routes Claude settings through new `writeClaudeSettings`, runs skills deploy, runs cursor MCP merge.
  - `packages/mcp/src/server.ts` — progressive registration limited to core 3 + meta.

## Key Technical Decisions

1. **Keyed merge** — `parse → set mcpServers[maina] → stringify(2)`. On unparseable JSON: rename the original to `settings.json.bak.<ts>` and write fresh. Never silent-overwrite.
2. **`bootstrap/scaffold`** — takes `{ cwd, withPrompts?, withSkills?, withWiki? }`. Writes only files that don't exist yet (idempotent). Returns `{ created, skipped }`.
3. **Single source of truth for `review.md` / `commit.md` templates** — lives in `bootstrap/scaffold.ts`. Both init and setup import from there.
4. **`skills-deploy`** — resolves each `packages/skills/*/SKILL.md` via `Bun.resolveSync('@mainahq/skills/package.json', cwd)` → walk sibling dirs. Falls back to the monorepo path when import.meta.resolve fails.
5. **Progressive MCP mode** — refactor `server.ts` so `registerCoreTools` wires only the 3 truly default tools, and extended tools are registered only when `allTools: true`. `list_tools` meta stays, but agents calling an extended tool in progressive mode currently fail because it isn't registered — intentional: the tool list is the discovery surface.
6. **`region.ts` JSON extension** — add `mergeJsonKeyed(existingText, key, value)` that parses, sets `key`, serialises. Markdown `mergeManaged` untouched.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/bootstrap/index.ts` | Barrel | New |
| `packages/core/src/bootstrap/scaffold.ts` | `scaffold({ cwd, ... })` writes `.maina/{constitution stub, prompts, features/.gitkeep, cache/, config.yml}` | New |
| `packages/core/src/bootstrap/__tests__/scaffold.idempotent.test.ts` | Two calls = identical trees | New |
| `packages/core/src/setup/agent-files/claude.ts` | `writeClaudeSettings(cwd, { mainaMcpEntry })` keyed merge + `writeClaudeMd(cwd, { constitutionExcerpt })` wrapper | New |
| `packages/core/src/setup/agent-files/cursor.ts` | `writeCursorMcp(cwd, { mainaMcpEntry })` keyed merge | New |
| `packages/core/src/setup/agent-files/region.ts` | Extend with `mergeJsonKeyed` helper | Modified |
| `packages/core/src/setup/agent-files/__tests__/claude-settings.merge.test.ts` | Property test, 50+ configs | New |
| `packages/core/src/setup/agent-files/__tests__/cursor-mcp.merge.test.ts` | Cursor merge tests | New |
| `packages/core/src/setup/agent-files/__tests__/cursor-rules.snapshot.test.ts` | MDC snapshot | New |
| `packages/core/src/setup/skills-deploy.ts` | Copy skills | New |
| `packages/core/src/setup/__tests__/skills-deploy.test.ts` | 8 SKILL.md materialise | New |
| `packages/core/src/init/index.ts` | Delegate to `bootstrap/scaffold` | Modified |
| `packages/core/src/index.ts` | Export new barrels | Modified |
| `packages/core/src/setup/index.ts` | Export new helpers | Modified |
| `packages/cli/src/commands/setup.ts` | Route through `bootstrap/scaffold` + new Claude merge + skills deploy + cursor merge | Modified |
| `packages/mcp/src/server.ts` | True progressive mode (3 tools only in default) | Modified |
| `packages/mcp/src/__tests__/progressive-tools.test.ts` | Default 3, list 10, `--all-tools` opts out | New |

## Tasks

TDD: every implementation task must have a preceding test task.

- [ ] T1 test: scaffold idempotent (`scaffold.idempotent.test.ts`)
- [ ] T2 impl: `bootstrap/scaffold.ts` + barrel
- [ ] T3 test: keyed Claude settings merge (property test, 50+ configs)
- [ ] T4 impl: `agent-files/claude.ts` `writeClaudeSettings`
- [ ] T5 test: cursor mcp merge
- [ ] T6 impl: `agent-files/cursor.ts` `writeCursorMcp`
- [ ] T7 test: cursor rules MDC snapshot
- [ ] T8 impl: ensure `.cursor/rules/maina.mdc` renders correctly (existing gen, snapshot existing output)
- [ ] T9 test: skills-deploy materialises 8 SKILL.md
- [ ] T10 impl: `skills-deploy.ts`
- [ ] T11 test: progressive MCP (default 3 + list_tools; --all-tools → 10, no list_tools)
- [ ] T12 impl: `server.ts` true progressive mode
- [ ] T13 impl: wire `init` through `bootstrap/scaffold`
- [ ] T14 impl: wire `setup` through `bootstrap/scaffold` + Claude merge + cursor merge + skills deploy
- [ ] T15 export through barrels

## Failure Modes

- **Unparseable existing `.claude/settings.json`** → rename to `.bak.<ts>`, write fresh. Logged via warning, not an error.
- **Missing `@mainahq/skills` in node_modules** → skip skills deploy with a warning; never fail setup.
- **Partial write on settings merge** → atomic write via temp + rename (same pattern as `atomicWrite` in setup.ts).
- **Multiple concurrent `maina setup` invocations** — atomic temp+rename keeps the file well-formed, worst case the "loser" overwrites the "winner". Acceptable.

## Testing Strategy

- Unit tests on `mergeJsonKeyed` — pure function, easy property coverage.
- Fixture tests on `writeClaudeSettings` and `writeCursorMcp` — temp dirs via `Bun.write`/`mkdtempSync`.
- Integration: `progressive-tools.test.ts` inspects `server._registeredTools` (already used by existing server.test.ts).
- Idempotency: second call must produce the same byte content.

## Wiki Context

### Related Decisions

- 0016-error-reporting-backend: Error and telemetry backend (PostHog) [accepted]

### Similar Features

- 037-error-id-surface: Implementation Plan
- 004-mcp-server: Implementation Plan

### Suggestions

- Feature 037-error-id-surface did something similar — check wiki/features/037-error-id-surface.md
- Feature 004-mcp-server did something similar — check wiki/features/004-mcp-server.md
- ADR 0016-error-reporting-backend (Error and telemetry backend (PostHog)) is accepted — ensure compatibility
