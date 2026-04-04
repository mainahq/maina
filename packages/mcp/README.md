# @maina/mcp

MCP (Model Context Protocol) server for Maina. Works with Claude Code, Cursor, Codex, and any MCP-compatible host.

## Setup

```json
{
  "mcpServers": {
    "maina": {
      "command": "maina",
      "args": ["--mcp"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `getContext` | Get focused codebase context for a command |
| `getConventions` | Get project constitution and conventions |
| `suggestTests` | Generate TDD test stubs |
| `checkSlop` | Check code for AI-generated slop patterns |
| `reviewCode` | Run two-stage review (spec compliance + code quality) |
| `analyzeFeature` | Check spec/plan/tasks consistency |
| `explainModule` | Get Mermaid dependency diagram |
| `verify` | Run full verification pipeline |

## Host Delegation

When running inside a host agent (Claude Code, Codex) without an API key, AI-dependent tools return structured `DelegationPrompt` objects for the host to process natively.

## License

Apache-2.0
