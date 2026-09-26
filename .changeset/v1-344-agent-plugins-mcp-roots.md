---
"@mainahq/mcp": patch
---

MCP roots and a single server per process (FR-INS-3). A tool call without a `root` now lets the runtime ask the client for its MCP roots (`roots/list`, only when the client advertises the roots capability; none on error or after 5 s): the standalone runtime uses them after the host project dir and before its working directory, so an Agent Plugins client such as VS Code agent mode, which starts the server in the plugin folder, acts on the workspace it names. `RootResolver` takes an optional second `RootHints` argument, exported as a type. Importing `@mainahq/mcp` from a bundle no longer starts a second MCP server on the same stdio: the package auto-starts only when it is the process entry (`Bun.main === import.meta.path` and `import.meta.main`, since each alone misfires in one build: the bundled runtime, or the published `target: "node"` build imported by `maina --mcp`).
