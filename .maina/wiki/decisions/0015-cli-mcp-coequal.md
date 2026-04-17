# Decision: CLI and MCP are co-equal first-class surfaces

> Status: **accepted**

## Context

Maina serves two user shapes:

1. **Agent-native** — Claude Code, Cursor, Windsurf, Copilot via MCP tools
2. **Terminal-native** — CI pipelines, pre-commit hooks, scripting via `maina <cmd>`

Early feature work risks accidentally privileging one surface. For example, a feature might be CLI-only with no MCP equivalent, or MCP-first with a CLI afterthought.

## Decision

**Every feature must be reachable via both `maina <cmd>` and an equivalent MCP tool.**

### Rules

1. **Feature parity**: if `maina verify` exists, `verify` MCP tool must exist with equivalent functionality
2. **PR checklist**: every PR review includes "Does this feature work equally well from CLI and MCP?"
3. **Marketing parity**: mainahq.com shows both paths above the fold (curl install command + MCP badges for Claude Code, Cursor, Windsurf)
4. **Engine-first architecture**: features live in `packages/core`, CLI and MCP are thin wrappers. This naturally enforces parity.

### Current Surface Mapping

| CLI Command | MCP Tool | Status |
|-------------|----------|--------|
| `maina verify` | `verify` | Parity |
| `maina review` | `reviewCode` | Parity |
| `maina context` | `getContext` | Parity |
| `maina slop` | `checkSlop` | Parity |
| `maina explain` | `explainModule` | Parity |
| `maina spec` | `suggestTests` | Parity |
| `maina analyze` | `analyzeFeature` | Parity |
| `maina wiki query` | `wikiQuery` | Parity |
| `maina wiki status` | `wikiStatus` | Parity |
| `maina doctor` | `getConventions` | Partial (conventions only) |
| `maina commit` | — | CLI-only (intentional: commits are terminal actions) |
| `maina plan` | — | CLI-only (scaffolds files) |
| `maina design` | — | CLI-only (scaffolds ADR) |

## Rationale

### Positive

- No user shape is second-class
- Engine-first architecture naturally enforces this
- Marketing can credibly claim "works everywhere"

### Negative

- Slightly more work per feature (two thin wrappers instead of one)
- Some features are genuinely CLI-only (commit, plan, design) — exceptions are documented, not hidden
