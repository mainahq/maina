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
if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
	const { startServer } = await import("./server");
	await startServer({
		argv: process.argv,
		env: process.env,
		cwd: process.cwd(),
		home: homedir(),
	});
}
