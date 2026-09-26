/**
 * MCP server v2 (FR-MCP-1, FR-MCP-2, FR-MCP-4): a thin surface over runtime
 * capabilities.
 *
 * `createMcpServer(runtime, { tools })` registers the allow-listed tools
 * (the default set when `tools` is omitted) through the SDK's public
 * `registerTool`; tools outside the list are never registered. Every tool
 * resolves its root through the runtime, takes explicit files, paths or a
 * query, and answers with a `{ data, error, meta }` structured result plus
 * a text summary; a tool that throws answers with a `failed` error and the
 * server keeps serving (FR-MCP-5). An allow-list that names no known tool
 * serves an empty `tools/list`. The server reports maina's `VERSION`.
 * The prompts (FR-MCP-3) are registered through `registerPrompt`, each
 * only when every tool it names is registered; a prompt whose render
 * throws answers with a `failed` error, like a tool.
 *
 * `startMcp` serves a server over stdio, where stdout carries protocol
 * frames only. `startServer` is the process entry the CLI (`maina --mcp`)
 * and the standalone runtime (`maina mcp`) call: it reads the allow-list
 * from `--tools` or `MAINA_MCP_TOOLS` and builds the system runtime.
 */

import { Console } from "node:console";
import { VERSION } from "@mainahq/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
	allowListNotices,
	DEFAULT_TOOLS,
	knownTools,
	readToolsFlag,
	resolveAllowList,
	TOOLS_ENV,
	type ToolName,
} from "./allowlist";
import { servablePrompts } from "./prompts";
import type { PromptDefinition } from "./prompts/shared";
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

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

/** How long a call waits for the client's `roots/list` answer. */
const ROOTS_TIMEOUT_MS = 5_000;

/**
 * The client's MCP roots (FR-INS-3): an editor names its workspace folders
 * here, which is how a server started outside the project (an Agent Plugins
 * client starts it in the plugin root) finds it. None when the client has
 * no roots capability, or fails or times out answering.
 */
async function clientRoots(server: McpServer): Promise<readonly string[]> {
	if (server.server.getClientCapabilities()?.roots === undefined) return [];
	try {
		const { roots } = await server.server.listRoots(undefined, {
			timeout: ROOTS_TIMEOUT_MS,
		});
		return roots.map((root) => root.uri);
	} catch {
		return [];
	}
}

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
			let root: string | null = null;
			const meta = () => ({
				root,
				version: VERSION,
				durationMs: Math.round(performance.now() - started),
			});
			// A capability that throws (a legacy core path, a bug) answers
			// like any other failure, and the server keeps serving.
			try {
				const explicit = typeof args.root === "string" ? args.root : undefined;
				const resolved = await runtime.resolveRoot(explicit, {
					mcpRoots: () => clientRoots(server),
				});
				if (!resolved.ok) return errorResult(def.name, meta(), resolved.error);
				root = resolved.value;
				const outcome = await def.run(args, { root, runtime, enabled });
				return outcome.ok
					? successResult(def.name, { ...meta(), root }, outcome.value)
					: errorResult(def.name, meta(), outcome.error);
			} catch (e) {
				return errorResult(def.name, meta(), {
					kind: "failed",
					message: errorText(e),
				});
			}
		},
	);
}

function registerPrompt(server: McpServer, def: PromptDefinition): void {
	server.registerPrompt(
		def.name,
		{ title: def.title, description: def.description, argsSchema: def.args },
		(args: Readonly<Record<string, string | undefined>>) => {
			// A render that throws answers like a failing tool: a `failed`
			// error naming the prompt, and the server keeps serving. The SDK
			// turns a thrown McpError into the JSON-RPC error response.
			let text: string;
			try {
				text = def.render(args);
			} catch (e) {
				throw new McpError(
					ErrorCode.InternalError,
					`${def.name}: ${errorText(e)}`,
					{ kind: "failed", prompt: def.name, version: VERSION },
				);
			}
			return {
				description: def.description,
				messages: [{ role: "user", content: { type: "text", text } }],
			};
		},
	);
}

/**
 * A server with no tools still answers the tools capability it declares:
 * `tools/list` lists none and `tools/call` names the tool it cannot find.
 * The SDK installs both handlers on the first `registerTool`, which a
 * server whose allow-list names no known tool never makes.
 */
function serveNoTools(server: McpServer): void {
	server.server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: [],
	}));
	server.server.setRequestHandler(CallToolRequestSchema, (request) => {
		throw new McpError(
			ErrorCode.InvalidParams,
			`Tool ${request.params.name} not found: the allow-list names no known tool`,
		);
	});
}

export function createMcpServer(
	runtime: McpRuntime,
	options: McpOptions = {},
): McpServer {
	const server = new McpServer(
		{ name: "maina", version: VERSION },
		{ capabilities: { tools: {} } },
	);
	const enabled =
		options.tools === undefined
			? [...DEFAULT_TOOLS]
			: knownTools(options.tools);
	for (const name of enabled) {
		register(server, runtime, DEFINITIONS[name], enabled);
	}
	if (enabled.length === 0) serveNoTools(server);
	for (const prompt of servablePrompts(enabled)) {
		registerPrompt(server, prompt);
	}
	return server;
}

/**
 * stdout carries protocol frames only: every console method (from core, a
 * dependency, a stray debug line) is rebound to a console that writes to
 * stderr.
 */
function routeConsoleToStderr(): void {
	const quiet = new Console({
		stdout: process.stderr,
		stderr: process.stderr,
		colorMode: false,
	});
	for (const [name, value] of Object.entries(quiet)) {
		if (typeof value === "function") {
			Object.assign(console, { [name]: value.bind(quiet) });
		}
	}
	// Bun's own `console.write` also goes straight to fd 1, and a node
	// `Console` has no counterpart to rebind it to.
	if ("write" in console) {
		Object.assign(console, { write: writeToStderr });
	}
}

function writeToStderr(
	...data: ReadonlyArray<string | ArrayBufferView | ArrayBuffer>
): number {
	let written = 0;
	for (const chunk of data) {
		if (typeof chunk === "string") {
			process.stderr.write(chunk);
			written += Buffer.byteLength(chunk);
			continue;
		}
		const bytes = ArrayBuffer.isView(chunk)
			? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
			: new Uint8Array(chunk);
		process.stderr.write(bytes);
		written += bytes.byteLength;
	}
	return written;
}

type ProcessEvents = Readonly<{
	on: (event: string, listener: (error: unknown) => void) => unknown;
}>;

/**
 * FR-MCP-5 outside any request: a detached promise that rejects, or a
 * timer that throws, is logged on stderr and the process keeps serving.
 * Without a listener either one ends the process, and every open session
 * with it. Installed by the process entry only (`startServer`).
 */
export function keepServingOnStrayErrors(
	proc: ProcessEvents = process,
	write: (line: string) => void = (line) => {
		process.stderr.write(line);
	},
): void {
	// A throw inside an `uncaughtException` listener is fatal, so the log
	// line (stderr may be gone: EPIPE after the host closed it) never throws.
	const log = (what: string) => (error: unknown) => {
		try {
			write(`maina mcp: ${what} (still serving): ${errorText(error)}\n`);
		} catch {
			// Nowhere left to report it; keep serving.
		}
	};
	proc.on("uncaughtException", log("uncaught exception"));
	proc.on("unhandledRejection", log("unhandled rejection"));
}

/**
 * Serves the allow-listed tools until the client disconnects, over stdio
 * unless a `transport` is given. From here on stdout belongs to the
 * transport: console output is routed to stderr.
 */
export async function startMcp(
	runtime: McpRuntime,
	options: McpOptions = {},
	transport: Transport = new StdioServerTransport(),
): Promise<void> {
	routeConsoleToStderr();
	await createMcpServer(runtime, options).connect(transport);
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
 * the system runtime, stdio. Unknown tool names, and an allow-list that
 * names no known tool, are reported on stderr (never stdout, which
 * carries the protocol). A stray error outside any request is logged,
 * never fatal.
 */
export async function startServer(input: StartServerInput): Promise<void> {
	// Core modules stay silent on stderr while serving MCP.
	process.env.MAINA_MCP_SERVER = "1";
	keepServingOnStrayErrors();
	const allow = resolveAllowList({
		flag: readToolsFlag(input.argv),
		env: input.env[TOOLS_ENV],
	});
	for (const notice of allowListNotices(allow)) {
		process.stderr.write(`${notice}\n`);
	}
	const runtime = systemRuntime({
		cwd: input.cwd,
		env: input.env,
		...(input.home !== undefined ? { home: input.home } : {}),
		...(input.resolveRoot ? { resolveRoot: input.resolveRoot } : {}),
	});
	await startMcp(runtime, { tools: allow.tools });
}
