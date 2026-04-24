# 0032. Agent.id format

Date: 2026-04-25

## Status

Accepted

## Context

`adr/0030-receipt-v1-field-schema.md` declared `agent.id` as a non-empty string but deferred format with a `[NEEDS CLARIFICATION]` marker: slug? UUID? host-prefixed? Wave 2's receipt generator (mainahq/maina#237) needs a locked format — without one, independent implementations diverge the moment they start synthesizing this field, which breaks cross-agent comparison.

The direction doc lists 11 host integrations already: Claude Code, Cline, Codex, Continue, Copilot, Cursor, Gemini CLI, OpenHands, Roo Code, Windsurf, Zed AI. Agent identity has two axes — the **host** (the editor/tool calling Maina) and the **agent** (the model behind it). Both matter: dashboard analytics in Wave 5 will slice on host × agent to surface where slop originates, and the GitHub App walkthrough comment in Wave 4 will name both.

## Decision

**`agent.id` is a host-prefixed slug of the form `<host>:<agent>`**, where each part matches `/^[a-z0-9][a-z0-9-]*$/`.

### Format

```text
<host>:<agent>
```

- `host` — the calling tool, slug from the direction doc's canonical 11-host list plus `ci` (fallback).
- `agent` — the model family name, slug (lowercase, kebab-case).

### Examples

| Host | Agent | `agent.id` |
|---|---|---|
| Claude Code | Claude Opus | `claude-code:opus` |
| Claude Code | Claude Sonnet | `claude-code:sonnet` |
| Cursor | Claude Sonnet | `cursor:sonnet` |
| Cursor | GPT-5 | `cursor:gpt-5` |
| GitHub Copilot | GPT-4.1 | `copilot:gpt-4-1` |
| OpenAI Codex | o3 | `codex:o3` |
| Gemini CLI | Gemini 2.5 Flash | `gemini-cli:flash` |
| Windsurf | Claude Sonnet | `windsurf:sonnet` |
| Cline | Claude Opus | `cline:opus` |
| Continue | Claude Sonnet | `continue:sonnet` |
| Roo Code | Claude Sonnet | `roo-code:sonnet` |
| OpenHands | Claude Opus | `openhands:opus` |
| Zed AI | Claude Sonnet | `zed-ai:sonnet` |
| *Any CI runner with no detected host* | *Any* | `ci:unknown` |

The `modelVersion` field on the receipt (separate from `agent.id`) carries the precise upstream version string (e.g. `claude-opus-4-7`). `agent.id` is the *slug* for dashboards and analytics; `modelVersion` is the *exact* version for audit.

### Detection precedence

When Maina emits a receipt — via `maina pr` per constitution C5, which gets a dedicated receipt generator in mainahq/maina#237 — it synthesizes `agent.id` from the first matching source in this order:

1. **Environment variable** — `MAINA_AGENT_ID`, if set, wins. Escape hatch for CI + scripts that need to pin an identity explicitly.
2. **MCP context** — if the host is a registered MCP client, the MCP handshake identifies it; the model is taken from the host's identity.
3. **Git trailer** — if the last commit has an `Agent: <host>:<agent>` trailer, use that verbatim.
4. **Fallback** — `ci:unknown`. Never empty; the schema pattern rejects empty strings anyway.

### Schema update

Tighten the `agent.id` pattern in `mainahq/receipt-schema/v1.json` to `^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$` **before `v1.json` is tagged and published to npm**. Current state: the repo exists (mainahq/receipt-schema) but `v1.0.0` has not yet been published — no DNS, no npm release, no downstream consumers. Tightening the pattern during this pre-publish window is not a breaking contract change.

**After** `v1.0.0` is tagged and published, `v1.json` becomes immutable per ADR 0030 / constitution — any further changes ship as `v2.json`. This ADR is explicitly scoped to the pre-publish window; it will be void once v1 is pinned.

## Consequences

### Positive

- **Cross-host analytics work from day 1.** Layer 4 rollup (Wave 5) can slice on `split(agent.id, ':')[0]` for host and `[1]` for agent without bespoke parsers.
- **Self-documenting.** `claude-code:opus` reads like English; no translation layer needed in the GitHub App walkthrough comment.
- **Stable over model upgrades.** `claude-code:opus` stays the same slug whether it's Opus 4.6 or 4.7 — the precise version lives in `modelVersion`, not `agent.id`.
- **Clear detection order.** env var > MCP > trailer > fallback. No guessing about precedence in Wave 2 implementation.
- **Receipts from CI without a host are legible.** `ci:unknown` is a valid slug; not a magic empty string.

### Negative

- **Name collisions across hosts.** Two hosts could pick different agent slugs for the same underlying model (`cursor:sonnet` vs `cline:claude-sonnet`). Accepted: receipts are per-host, comparing across hosts is a dashboard concern that can normalize in Wave 5.
- **Slug maintenance.** New hosts and new models require updates to a canonical slug table. Mitigation: in the Wave 2 receipt generator (mainahq/maina#237) the table will live at `packages/core/src/receipt/agent-id.ts` as the single source of truth; ADR 0032 is the authoritative spec it materializes.
- **Multi-model sessions.** If an agent switches models mid-PR (e.g. planning with Opus, implementing with Sonnet), `agent.id` reflects only the last one. Accepted for v1: the retry counter (ADR 0031) already signals "this receipt is not a clean first-run", and receipts are an integrity primitive, not a session log.

## References

- Parent ADR: adr/0030-receipt-v1-field-schema.md
- Direction doc (private): `mainahq/maina-cloud:strategy/DIRECTION_AND_BUILD_PLAN_2026_04_25.md`
- Tracking issue: [mainahq/maina#236](https://github.com/mainahq/maina/issues/236)
- Schema repo (pattern update lands here): https://github.com/mainahq/receipt-schema
