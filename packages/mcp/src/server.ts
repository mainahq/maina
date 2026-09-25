/**
 * MCP server v2 (FR-MCP-1, FR-MCP-2, FR-MCP-4): a thin surface over runtime
 * capabilities.
 *
 * `createMcpServer(runtime, { tools })` registers the allow-listed tools
 * (the default set when `tools` is omitted) through the SDK's public
 * `registerTool`; tools outside the list are never registered. Every tool
 * resolves its root through the runtime, takes explicit files, paths or a
 * query, and answers with a `{ data, error, meta }` structured result plus
 * a text summary.
 *
 * `startMcp` serves a server over stdio. `startServer` is the process
 * entry the CLI (`maina --mcp`) and the standalone runtime (`maina mcp`)
 * call: it reads the allow-list from `--tools` or `MAINA_MCP_TOOLS` and
 * builds the system runtime.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	DEFAULT_TOOLS,
	knownTools,
	readToolsFlag,
	resolveAllowList,
	TOOLS_ENV,
	type ToolName,
} from "./allowlist";
import type { McpRuntime, RootResolver } from "./runtime";
import { systemRuntime } from "./system-runtime";
import { contextTool } from "./tools/context";
import { decideTool } from "./tools/decide";
import {
	askQuestionTool,
	readWikiContentsTool,
	readWikiStructureTool,
} from "./tools/deepwiki";
import { impactTool } from "./tools/impact";
import { receiptTool } from "./tools/receipt";
import { reviewTriageTool } from "./tools/review-triage";
import {
	errorResult,
	successResult,
	type ToolDefinition,
} from "./tools/shared";
import { specCheckTool } from "./tools/spec-check";
import { statusTool } from "./tools/status";
import { verifyTool } from "./tools/verify";

const DEFINITIONS: Readonly<Record<ToolName, ToolDefinition>> = {
	verify: verifyTool,
	decide: decideTool,
	impact: impactTool,
	context: contextTool,
	review_triage: reviewTriageTool,
	spec_check: specCheckTool,
	receipt: receiptTool,
	status: statusTool,
	ask_question: askQuestionTool,
	read_wiki_structure: readWikiStructureTool,
	read_wiki_contents: readWikiContentsTool,
};

export type McpOptions = Readonly<{
	/** Tool names to register; unknown names are ignored. Defaults to the default set. */
	tools?: readonly string[];
}>;

function register(
	server: McpServer,
	runtime: McpRuntime,
	def: ToolDefinition,
	enabled: readonly ToolName[],
): void {
	server.registerTool(
		def.name,
		{
			description: def.description,
			inputSchema: def.input,
			outputSchema: def.output,
			annotations: { readOnlyHint: def.readOnly },
		},
		async (args: Readonly<Record<string, unknown>>) => {
			const started = performance.now();
			const elapsed = () => Math.round(performance.now() - started);
			const explicit = typeof args.root === "string" ? args.root : undefined;
			const root = await runtime.resolveRoot(explicit);
			if (!root.ok) {
				return errorResult(
					def.name,
					{ root: null, version: runtime.version, durationMs: elapsed() },
					root.error,
				);
			}
			const outcome = await def.run(args, {
				root: root.value,
				runtime,
				enabled,
			});
			const meta = {
				root: root.value,
				version: runtime.version,
				durationMs: elapsed(),
			};
			return outcome.ok
				? successResult(def.name, meta, outcome.value)
				: errorResult(def.name, meta, outcome.error);
		},
	);
}

export function createMcpServer(
	runtime: McpRuntime,
	options: McpOptions = {},
): McpServer {
	const server = new McpServer(
		{ name: "maina", version: runtime.version },
		{ capabilities: { tools: {} } },
	);
	const enabled =
		options.tools === undefined
			? [...DEFAULT_TOOLS]
			: knownTools(options.tools);
	for (const name of enabled) {
		register(server, runtime, DEFINITIONS[name], enabled);
	}
	return server;
}

/** Serves the allow-listed tools over stdio until the client disconnects. */
export async function startMcp(
	runtime: McpRuntime,
	options: McpOptions = {},
): Promise<void> {
	await createMcpServer(runtime, options).connect(new StdioServerTransport());
}

export type StartServerInput = Readonly<{
	argv: readonly string[];
	/** The process environment: the allow-list env var, AI keys, child processes. */
	env: Readonly<Record<string, string | undefined>>;
	/** The user's home, for the user policy layer. */
	home?: string;
	/** Where a call without an explicit root looks for the repository. */
	cwd: string;
	/** Replaces the default root resolution (the standalone runtime's own). */
	resolveRoot?: RootResolver;
}>;

/**
 * The MCP process entry: allow-list from `--tools` or `MAINA_MCP_TOOLS`,
 * the system runtime, stdio. Unknown tool names are reported on stderr
 * (never stdout, which carries the protocol) and skipped.
 */
export async function startServer(input: StartServerInput): Promise<void> {
	// Core modules stay silent on stderr while serving MCP.
	process.env.MAINA_MCP_SERVER = "1";
	const allow = resolveAllowList({
		flag: readToolsFlag(input.argv),
		env: input.env[TOOLS_ENV],
	});
	if (allow.unknown.length > 0) {
		process.stderr.write(
			`maina mcp: ignoring unknown tool(s) in the ${allow.source === "flag" ? "--tools flag" : TOOLS_ENV}: ${allow.unknown.join(", ")}\n`,
		);
	}
	const runtime = systemRuntime({
		cwd: input.cwd,
		env: input.env,
		...(input.home !== undefined ? { home: input.home } : {}),
		...(input.resolveRoot ? { resolveRoot: input.resolveRoot } : {}),
	});
	await startMcp(runtime, { tools: allow.tools });
}
