/**
 * MCP Server — exposes Maina engines as tools for Claude Code, Cursor, and other IDE agents.
 *
 * Progressive disclosure (default): only the 3 highest-value tools
 * (`verify`, `getContext`, `reviewCode`) are registered at handshake. A
 * `list_tools` meta-tool advertises the full 10-tool surface; the 7
 * extended tools are NOT registered in progressive mode, so agents must
 * opt in by restarting the server with `--all-tools`.
 *
 * This keeps the handshake payload small — important because every tool
 * description is streamed to the host on every session start, burning
 * conversation context.
 *
 * `allTools: true` opts out — all 10 tools are registered at handshake
 * and `list_tools` is not exposed.
 *
 * DeepWiki-compat tools (`ask_question`, `read_wiki_structure`,
 * `read_wiki_contents`) are shipped in `registerDeepWikiTools` and are NOT
 * part of the 10-tool MCP surface; they are a separate wire compatibility
 * layer and are only registered in `allTools` mode today.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerContextTools } from "./tools/context";
import { registerDeepWikiTools } from "./tools/deepwiki";
import { registerExplainTools } from "./tools/explain";
import { registerFeatureTools } from "./tools/features";
import { registerReviewTools } from "./tools/review";
import { registerVerifyTools } from "./tools/verify";
import { registerWikiTools } from "./tools/wiki";

export interface McpServerOptions {
	/** Register all tools at handshake instead of progressive disclosure */
	allTools?: boolean;
}

/**
 * The full 10-tool MCP surface advertised by `list_tools`.
 *
 * Order matters for display — keep the three progressive-mode defaults
 * (`verify`, `getContext`, `reviewCode`) at the top.
 */
const ALL_TOOL_DESCRIPTIONS = [
	{
		name: "verify",
		description: "Run the full verification pipeline on staged/changed files",
	},
	{
		name: "getContext",
		description: "Get focused codebase context for a command",
	},
	{
		name: "reviewCode",
		description:
			"Run two-stage review (spec compliance + code quality) on a diff",
	},
	{
		name: "checkSlop",
		description: "Detect AI-generated slop patterns in changed files",
	},
	{
		name: "getConventions",
		description: "Get project constitution and conventions",
	},
	{
		name: "explainModule",
		description: "Explain a module with dependency diagram",
	},
	{
		name: "suggestTests",
		description: "Generate TDD test stubs from a plan or spec",
	},
	{
		name: "analyzeFeature",
		description: "Analyze a feature directory for spec/plan consistency",
	},
	{
		name: "wikiQuery",
		description: "Search and synthesize answers from codebase wiki knowledge",
	},
	{
		name: "wikiStatus",
		description: "Wiki health check — article counts, staleness, coverage",
	},
];

/** Names of the 3 tools registered at handshake by default. */
export const DEFAULT_MCP_TOOLS = [
	"verify",
	"getContext",
	"reviewCode",
] as const;

function registerListToolsMeta(server: McpServer): void {
	server.tool(
		"list_tools",
		"List all available Maina MCP tools with descriptions. Default mode only registers 3 tools at handshake — this meta-tool advertises the full 10-tool surface. To call an extended tool, restart the MCP server with `--all-tools` or via `createMcpServer({ allTools: true })`.",
		{},
		async () => {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								data: {
									tools: ALL_TOOL_DESCRIPTIONS,
									total: ALL_TOOL_DESCRIPTIONS.length,
									defaultRegistered: DEFAULT_MCP_TOOLS,
								},
								error: null,
								meta: {
									hint: "Only the 3 tools in `defaultRegistered` are callable in progressive mode. Restart with `--all-tools` to enable the rest.",
								},
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

/**
 * Register only the 3 highest-value tools used in progressive mode.
 *
 * The underlying `registerVerifyTools` / `registerContextTools` / ... helpers
 * bundle multiple tools per file; we rely on the existing bundling but
 * accept that `checkSlop` and `getConventions` are co-registered with
 * their siblings. We wrap those with per-tool deregistration after
 * registration so the handshake only exposes the 3 defaults.
 */
function registerProgressiveTools(server: McpServer): void {
	// Register the bundles that own our 3 default tools.
	registerVerifyTools(server); // verify, checkSlop
	registerContextTools(server); // getContext, getConventions
	registerReviewTools(server); // reviewCode

	// Deregister the non-default siblings so only the 3 defaults remain.
	// biome-ignore lint/suspicious/noExplicitAny: accessing private registry
	const internal = server as any;
	const registry: Record<string, unknown> = internal._registeredTools ?? {};
	const allowed = new Set<string>(DEFAULT_MCP_TOOLS);
	for (const name of Object.keys(registry)) {
		if (!allowed.has(name)) {
			delete registry[name];
		}
	}
}

/** Register all 10 Maina tools (progressive-mode opt-out). */
function registerAllTools(server: McpServer): void {
	registerVerifyTools(server); // verify, checkSlop
	registerContextTools(server); // getContext, getConventions
	registerReviewTools(server); // reviewCode
	registerFeatureTools(server); // suggestTests, analyzeFeature
	registerExplainTools(server); // explainModule
	registerWikiTools(server); // wikiQuery, wikiStatus
	// DeepWiki compat tools are a separate surface — see module docstring.
	registerDeepWikiTools(server); // ask_question, read_wiki_structure, read_wiki_contents

	// The 10-tool surface specified in the parent onboarding-60s spec. The
	// DeepWiki-compat tools live alongside but are NOT part of the 10; drop
	// them from the registry when the test/CLI wants strict 10-tool mode.
	// For the default allTools behaviour we keep them registered for
	// backward-compatibility with existing DeepWiki clients.
	if (process.env.MAINA_MCP_STRICT_TEN === "1") {
		// biome-ignore lint/suspicious/noExplicitAny: accessing private registry
		const internal = server as any;
		const registry: Record<string, unknown> = internal._registeredTools ?? {};
		const allowed = new Set<string>(ALL_TOOL_DESCRIPTIONS.map((t) => t.name));
		for (const name of Object.keys(registry)) {
			if (!allowed.has(name)) {
				delete registry[name];
			}
		}
	}
}

export function createMcpServer(options?: McpServerOptions): McpServer {
	const server = new McpServer(
		{ name: "maina", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	if (options?.allTools) {
		registerAllTools(server);
		// Strict 10-tool surface for the `allTools` path — DeepWiki compat
		// stays available via the separate entry point but is not counted
		// in the 10-tool spec surface.
		// biome-ignore lint/suspicious/noExplicitAny: accessing private registry
		const internal = server as any;
		const registry: Record<string, unknown> = internal._registeredTools ?? {};
		const allowed = new Set<string>(ALL_TOOL_DESCRIPTIONS.map((t) => t.name));
		for (const name of Object.keys(registry)) {
			if (!allowed.has(name)) {
				delete registry[name];
			}
		}
	} else {
		registerProgressiveTools(server);
		registerListToolsMeta(server);
	}

	return server;
}

export async function startServer(allTools?: boolean): Promise<void> {
	// Signal to core modules that we're running as MCP — suppress all stderr output
	process.env.MAINA_MCP_SERVER = "1";

	const server = createMcpServer({ allTools });
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
