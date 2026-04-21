# Feature 053 — Onboarding-60s Wave 3: Bootstrap Merge + IDE Wiring

## Problem Statement

Today `maina init` and `maina setup` scaffold `.maina/` via two drifted code paths. The result is that the two commands write subtly different trees — users who re-run the other command get surprising diffs, and maintenance requires touching two places for every change.

In parallel, `.claude/settings.json` and `.cursor/mcp.json` are written with a full overwrite + `.bak` fallback. Users who already have MCP servers configured for other tools lose their entries on every run.

And the MCP server registers 13 tools at handshake — forcing host agents to scan a long tool list and burning context before the user has even asked for anything.

## Target User

- Primary: a developer running `maina setup` for the first time in a repo that already has Claude Code configured with their own MCP servers, editor tweaks, or Cursor rules. The user expects `maina setup` to be additive, not destructive.
- Secondary: a maintainer fixing a bug in the init/setup scaffolding who currently has to chase two files.
- Tertiary: a Claude Code session that burns 1–3k tokens at handshake on tools it will likely never use.

## User Stories

- As a Claude Code user with an existing `~/.claude/settings.json`, I want `maina setup` to merge Maina's MCP entry into my settings without touching my other MCP servers.
- As a Cursor user with existing `.cursor/mcp.json` entries, I want the Maina entry added without losing my existing entries.
- As a maintainer, I want a single `bootstrap/scaffold.ts` module that both `init` and `setup` call, so I edit one place.
- As a Claude Code session, I want to see only 3 tools by default (`verify`, `getContext`, `reviewCode`); I'll call `list_tools` if I need more.
- As a power user, I want `--all-tools` to register all 10 at handshake when I know I'll use them.
- As a setup user, I want `.maina/skills/<name>/SKILL.md` materialised from `@mainahq/skills` after setup completes, so my agent can discover them.

## Success Criteria

Every criterion must be testable.

- [ ] `packages/core/src/bootstrap/scaffold.ts` exists, is exported via `packages/core/src/bootstrap/index.ts`, and both `init` and `setup` route scaffolding through it.
- [ ] Calling `scaffold({ cwd, withPrompts: true })` twice on the same tree yields byte-identical results (idempotent).
- [ ] `.claude/settings.json` keyed merge: given a pre-existing file with `mcpServers: { existing: { command: "x" } }`, after setup the file has BOTH `existing` and `maina` entries, and `existing` is preserved byte-for-byte (modulo JSON formatter).
- [ ] Property test with 50+ random pre-existing configs confirms user MCPs are preserved.
- [ ] `.cursor/mcp.json` same merge behaviour.
- [ ] Default MCP server (`createMcpServer()`) registers exactly 3 tools plus the `list_tools` meta-tool (4 total).
- [ ] `list_tools` returns exactly 10 tool descriptions.
- [ ] `createMcpServer({ allTools: true })` registers all 10 tools and no `list_tools`.
- [ ] After `maina setup`, `.maina/skills/<name>/SKILL.md` exists for every skill published in `@mainahq/skills` (currently 8).
- [ ] Running setup twice re-materialises identical skill files (idempotent, no duplicates).
- [ ] `.maina/prompts/review.md` and `.maina/prompts/commit.md` exist with identical content whether they were written by `init` or `setup`.

## Scope

### In Scope

- Extract shared scaffolding into `packages/core/src/bootstrap/scaffold.ts`.
- Rewrite `ensureClaudeSettings` / Claude `settings.json` / Cursor `mcp.json` writers to use keyed JSON merge.
- Create `packages/core/src/setup/agent-files/claude.ts` as the new home for `writeClaudeSettings` + `writeClaudeMd` wrappers (keyed merge).
- Create `packages/core/src/setup/agent-files/cursor.ts` for `.cursor/mcp.json` keyed merge.
- Extend `region.ts` with JSON-aware managed regions (keyed merge helpers) for future callers — markdown helpers stay unchanged.
- Skills deploy: `packages/core/src/setup/skills-deploy.ts` copies each `packages/skills/*/SKILL.md` → `<cwd>/.maina/skills/<name>/SKILL.md`.
- MCP progressive disclosure: default 3 tools, `list_tools` meta returns 10, `--all-tools` opts out.
- Update `packages/core/src/index.ts` and `packages/core/src/setup/index.ts` to export new surfaces.

### Out of Scope

- Constitution derivation (Wave 2).
- `adopt.ts`, `scan/*`, `confirm.ts`, `tailor.ts`, `prompts/universal.md` (Wave 2 owns these).
- `doctor.ts` (Wave 1), `program.ts`, `commands/context.ts` (Wave 4).
- README.md, install.sh, Wave 1 features 050/*.
- TOML-based configs (Codex etc.) — they have their own merger in `core/src/mcp/` already.
- Global (`~/.claude/settings.json`) writes — this wave only handles project-scope `.claude/settings.json`.

## Design Decisions

1. **Keyed JSON merge over raw overwrite.** Parse the existing JSON, mutate `mcpServers.maina`, write back with 2-space indent. When the file is unreadable/invalid JSON we rename to `.bak.<ts>` and write fresh — that's a real recovery path, not a routine case.
2. **No external dependency for JSON formatting preservation.** `jsonc-parser` would keep comments, but `.claude/settings.json` is plain JSON in practice. Keeping the surface small outweighs comment preservation.
3. **Progressive disclosure registers ALL 10 handlers but only exposes 3 at list time** — the MCP SDK doesn't expose tool-list filtering per-request, so we need two `createMcpServer` modes. Mode A (default) registers only `verify/getContext/reviewCode` + `list_tools`. Mode B (`allTools`) registers all 10.
4. **Single `bootstrap/scaffold.ts` that writes minimal shared files.** Agent files and IDE MCP settings stay in `setup/` because they depend on stack detection and AI output; only the truly static `.maina/` skeleton moves to `bootstrap/`.
5. **Skills materialisation reads from `@mainahq/skills` package resolution** — works in both monorepo and installed-from-npm scenarios. Falls back to a warning (not an error) when the skills package isn't resolvable.

## Open Questions

None that block implementation. Parent spec §6.5 + §6.7 cover acceptance.
