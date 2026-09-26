import { homedir } from "node:os";

export {
	ALL_TOOLS,
	type AllowList,
	DEEPWIKI_TOOLS,
	DEFAULT_TOOLS,
	readToolsFlag,
	resolveAllowList,
	TOOLS_ENV,
	type ToolName,
} from "./allowlist";
export type {
	McpRuntime,
	RootHints,
	RootResolver,
	RuntimeError,
} from "./runtime";
export {
	createMcpServer,
	type McpOptions,
	type StartServerInput,
	startMcp,
	startServer,
} from "./server";
export { type SystemRuntimeOptions, systemRuntime } from "./system-runtime";

// Auto-start when run directly: `bun packages/mcp/src/index.ts [--tools a,b]`.
// `import.meta.main`, not `Bun.main === import.meta.path`: bundled into
// another entry (the standalone runtime), every module shares the bundle's
// path, and a second server would answer on the same stdio.
if (typeof Bun !== "undefined" && import.meta.main) {
	const { startServer } = await import("./server");
	await startServer({
		argv: process.argv,
		env: process.env,
		cwd: process.cwd(),
		home: homedir(),
	});
}
