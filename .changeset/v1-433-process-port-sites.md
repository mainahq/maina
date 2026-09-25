---
"@mainahq/core": major
"@mainahq/cli": patch
"@mainahq/mcp": patch
---

Every child process in core now goes through `ProcessPort`. The remaining direct spawns in retrieval, the benchmark runner, traceability, PR-review ingestion, lifecycle hooks, tickets, tool detection, the syntax guard, wiki lint, visual screenshots and the proof test run now each accept an optional port, which defaults to `systemProcess`. The purity allow-list is down to the adapter itself. `runPipeline` takes a `process` option and passes it to the syntax guard, tool detection, every external runner, the type checker and wiki lint. The CLI and MCP now pass `systemProcess` explicitly. `SpawnOptions` gains `stdin`. After a timeout, the system adapter sends SIGTERM and escalates to SIGKILL if the child is still alive after a grace period. Breaking changes: `runWikiLint` is now async, and `TicketOptions.cwd` is required. `systemProcess` and `stripRepoLocalGitEnv` are exported so that the runtime's root probe drops the same repo-local `GIT_*` variables as core.
