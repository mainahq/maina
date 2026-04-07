# Decision: Fix host delegation for CLI AI tasks

> Status: **proposed**

## Context

When `maina design --hld` runs inside Claude Code, the subprocess detects host mode (CLAUDECODE=1) but has no API keys. `shouldDelegateToHost()` returns true, but the subprocess can't send delegation prompts back to the host. AI-dependent CLI commands silently produce empty output.

## Decision

Three changes:
1. `tryAIGenerate` strips `[HOST_DELEGATION]` prefix and returns the structured prompt as usable text instead of marking it as delegation
2. `generateHldLld` returns an explicit error instead of silent null when AI is unavailable
3. CLI design command shows clear error message when HLD generation fails

## Rationale

### Positive

- No more silently empty ADRs from `--hld`
- Clear error messages when AI is unavailable
- Host delegation text is usable as structured content

### Negative

- Delegation text is a prompt, not AI-generated content — lower quality than actual AI output

### Neutral

- MCP delegation path unchanged
- Users with API keys unaffected
