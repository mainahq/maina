# Decision: AI delegation protocol for host agents

> Status: **proposed**

## Context

AI features are non-functional when maina runs as a subprocess inside Claude Code, Codex, or OpenCode. No API key is available. The current DelegationPrompt object is returned but never acted on.

## Decision

Plain text stdout protocol. AI-dependent steps output `---MAINA_AI_REQUEST---` blocks. Any host agent reading stdout can parse and process them. No IPC, no binary, no dependencies.

## Rationale

### Positive

- AI features work in every MCP-compatible host
- Zero integration effort for hosts — just parse stdout
- Existing direct API path unchanged

### Negative

- Host must understand the protocol (simple text parsing)
- No result injection back into pipeline (host acts independently)

### Neutral

- Protocol is versioned and extensible
