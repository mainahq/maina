# Decision: Kill decision — Fern + multi-language SDKs

> Status: **accepted**

## Context

Fern was considered for auto-generating multi-language SDKs. Evaluation:

- Maina has no REST API to wrap — MCP is the polyglot surface
- Peers (Ruff, uv, Biome, Bun, Vitest, Astro) ship zero SDKs
- Fern costs ~$600/mo per language — not justified without a REST API
- MCP clients already speak the protocol natively (Claude Code, Cursor, Windsurf, Copilot)

## Decision

Do not use Fern. Do not build multi-language SDKs. MCP is the polyglot interface.

Revisit in 2027 Q2 if a hosted REST API exists — use Speakeasy then, not Fern.

## Rationale

- Zero SDK maintenance burden
- MCP remains the single cross-platform integration surface
- Blog post: "Why Maina has no SDK" (pairs with #112)
- Roadmap tickets referencing Fern/SDK closed as won't-fix
