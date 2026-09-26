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
// Both checks, since each alone misfires in one build (#344):
// - bundled into another entry (the standalone runtime), every module
//   shares the bundle's path, so the path check passes; `import.meta.main`
//   is false there
// - the published build (bunup, `target: "node"`) rewrites
//   `import.meta.main` to `require.main == require.module`, true under Bun
//   for any importer (`maina --mcp`); the path check is false there
// Either misfire would start a second server on the importer's stdio.
if (
	typeof Bun !== "undefined" &&
	Bun.main === import.meta.path &&
	import.meta.main
) {
	const { startServer } = await import("./server");
	await startServer({
		argv: process.argv,
		env: process.env,
		cwd: process.cwd(),
		home: homedir(),
	});
}
