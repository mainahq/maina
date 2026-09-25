# @mainahq/mcp

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
| `verify` | Verification pipeline on explicit files, with each tool's status and skip reason |
| `decide` | Typed decisions (with probability distributions) under the repo's policy |
| `impact` | Callers, dependent files, covering tests and blast score for files or symbols |
| `context` | Minimal source context for files or a query, within a token budget |
| `review_triage` | Two-stage review of a diff, triaged into blocking, advisory and info |
| `spec_check` | Spec/plan/tasks consistency for feature directories |
| `receipt` | Verify receipt files against the v1 schema and canonical hash |
| `status` | Version, enabled tools, code graph, wiki and policy health |

Every tool takes an optional absolute `root` plus explicit `files`, `paths` or a `query`, and returns a text summary with structured content in a `{ data, error, meta }` envelope.

The DeepWiki-compatible tools (`ask_question`, `read_wiki_structure`, `read_wiki_contents`) are off by default. Choose tools with `--tools` or `MAINA_MCP_TOOLS` (comma-separated; `default` is the default set):

```bash
maina --mcp --tools default,ask_question
```

## Programmatic use

```ts
import { startMcp, systemRuntime } from "@mainahq/mcp";

await startMcp(systemRuntime({ cwd: process.cwd(), env: process.env }), {
  tools: ["verify", "status"],
});
```

## License

Apache-2.0
