# Feature 013: Fix Host Delegation for CLI AI Tasks

## Problem

When running `maina design --hld` inside Claude Code, the CLI subprocess detects `CLAUDECODE=1` and `CLAUDE_CODE_ENTRYPOINT=cli` env vars but has no API keys. `shouldDelegateToHost()` returns true, `generate()` returns `[HOST_DELEGATION]` text, but the subprocess has no way to send this back to the host. Result: `generateHldLld()` treats delegation as "AI unavailable" and silently returns null, producing ADRs with all `[NEEDS CLARIFICATION]` placeholders.

## Success Criteria

- **SC-1:** `tryAIGenerate()` in CLI mode (non-MCP) never returns `hostDelegation: true` — instead returns the delegation prompt as actual text for the caller to use
- **SC-2:** `generateHldLld()` returns an explicit error when AI cannot generate, never silently returns null
- **SC-3:** CLI `maina design --hld` either generates content or shows a clear error message
- **SC-4:** MCP mode still delegates correctly (no regression)
- **SC-5:** When ANTHROPIC_API_KEY is available in host mode, direct API call is used (already works)

## Out of Scope

- Making the CLI subprocess talk back to the host agent (would require IPC)
- Changing the MCP delegation path
- Adding new API key configuration flows

## Design

The fix has two parts:

### Part 1: `tryAIGenerate` returns delegation text as content

In `packages/core/src/ai/try-generate.ts`, when `hostDelegation: true`, instead of returning `{ hostDelegation: true }`, return the text as `fromAI: true`. The delegation prompt IS the AI's contribution — it's a well-structured prompt that contains the system prompt + user prompt. Callers can use this directly.

This works because:
- The delegation prompt contains `[HOST_DELEGATION] Task: design-hld-lld\n\nSystem: ...\n\nUser: ...`
- We strip the `[HOST_DELEGATION]` prefix and return the user prompt portion
- This gives the caller a structured prompt they can display or process

### Part 2: `generateHldLld` returns error instead of null

In `packages/core/src/design/index.ts`, change `generateHldLld` to return `{ ok: false, error: "..." }` when AI text is null, instead of `{ ok: true, value: null }`. The CLI can then show the error.

### Part 3: CLI shows clear error

In `packages/cli/src/commands/design.ts`, when `hldResult.ok` is false, show the error message with `log.error()` instead of `log.warn("AI unavailable")`.

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/ai/try-generate.ts` | Strip [HOST_DELEGATION] prefix, return as fromAI content |
| `packages/core/src/design/index.ts` | Return error Result when AI returns null |
| `packages/cli/src/commands/design.ts` | Show error message, not silent warning |
| `packages/core/src/ai/__tests__/ai.test.ts` | Test delegation text stripping |
| `packages/core/src/design/__tests__/generate-hld-lld.test.ts` | Test error return |
