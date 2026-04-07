# Feature 033: v1.0.3 Quick Wins

## Problem

Four gaps degrade the user experience before enterprise readiness:
1. Commands fail silently without AI — empty output, no explanation
2. `maina verify` without external linters passes everything — false confidence
3. `maina init` skips existing agent files instead of merging — existing projects get no maina integration
4. `maina doctor` doesn't check AI readiness — no diagnostic path when things don't work

## Success Criteria

### SC-1: Graceful AI Failures
- Commands requiring AI (`brainstorm`, `design`, `commit` AI message) detect AI availability at start
- When unavailable: print clear message with setup instructions, exit with code 3 (config error)
- Commands with deterministic fallbacks (`verify`, `review`) log "Running without AI — deterministic checks only"
- `requiresAI()` check function returns `{ available, method: "api-key" | "host-delegation" | "none", reason? }`

### SC-2: Verify Built-in Checks
- 7 built-in checks run always, even without external linters:
  - `console.log` in non-test files (warning)
  - Unused imports via regex (warning)
  - TODO/FIXME/HACK count (info)
  - Files > 500 lines (info)
  - `.env` / secrets in staged files (error)
  - Empty catch blocks (warning)
  - `any` type usage in TS files (warning)
- Checks run on diff-only files, return standard `Finding` interface
- When external tools ARE installed, built-in checks still run but don't duplicate findings
- Each check is a pure function `(filePath, content) => Finding[]`

### SC-3: Merge Agent Files
- When CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules, or copilot-instructions.md already exists during `maina init`:
  - Check if `## Maina` section already present (idempotent)
  - If not, append format-appropriate maina block with workflow + MCP tools
  - Report as "updated" in init output (not "created" or "skipped")
- Existing user content preserved — append only, never overwrite

### SC-4: Doctor Checks API
- New "AI Status" section in `maina doctor` output showing:
  - API key status (which key found, or none)
  - Host mode detection (Claude Code, Cursor, or none)
  - Feedback stats (total outcomes, accept rate)
  - Cache stats (entries, hit rate)
  - Prompt stats (tasks with feedback data)
- When broken, show actionable fix: "Run `maina init` to set up AI features"

## Files

| Change | File |
|--------|------|
| New | `packages/core/src/ai/availability.ts` — `requiresAI()` check |
| New | `packages/core/src/verify/builtin.ts` — 7 built-in checks |
| Modify | `packages/core/src/verify/pipeline.ts` — include built-in checks |
| Modify | `packages/core/src/init/index.ts` — merge logic for existing files |
| Modify | `packages/cli/src/commands/doctor.ts` — AI status section |
| Modify | `packages/cli/src/commands/brainstorm.ts` — AI availability check |
| Modify | `packages/cli/src/commands/design.ts` — AI availability check |
| Modify | `packages/cli/src/commands/commit.ts` — AI availability check |

## Out of Scope
- Interactive multiselect for tool installation (cosmetic)
- Pin Mermaid CDN version (cosmetic)
- Round-trip flywheel (that's v1.1.0)
