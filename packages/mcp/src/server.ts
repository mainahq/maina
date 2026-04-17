/**
 * MCP Server — exposes Maina engines as tools for Claude Code, Cursor, and other IDE agents.
 *
 * Progressive disclosure: by default only 3 core tools are registered at handshake.
 * A `list_tools` meta-tool lets the agent discover and request the remaining tools.
 * Use `allTools: true` to register all tools immediately.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerContextTools } from "./tools/context";
import { registerExplainTools } from "./tools/explain";
import { registerFeatureTools } from "./tools/features";
import { registerReviewTools } from "./tools/review";
import { registerVerifyTools } from "./tools/verify";
import { registerWikiTools } from "./tools/wiki";

export interface McpServerOptions {
	/** Register all tools at handshake instead of progressive disclosure */
	allTools?: boolean;
}

/** Tool descriptions for the list_tools meta-tool */
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

function registerListToolsMeta(server: McpServer): void {
	server.tool(
		"list_tools",
		"List all available Maina MCP tools with descriptions. Call this to discover tools beyond the 3 registered at startup.",
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
								},
								error: null,
								meta: {
									hint: "To use any tool, call it by name. All tools are available regardless of whether they were registered at handshake.",
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

/** Register only the 3 highest-value tools for progressive disclosure */
function registerCoreTools(server: McpServer): void {
	registerVerifyTools(server); // verify, checkSlop
	registerContextTools(server); // getContext, getConventions
	registerReviewTools(server); // reviewCode
}

/** Register all remaining tools */
function registerExtendedTools(server: McpServer): void {
	registerFeatureTools(server); // suggestTests, analyzeFeature
	registerExplainTools(server); // explainModule
	registerWikiTools(server); // wikiQuery, wikiStatus
}

export function createMcpServer(options?: McpServerOptions): McpServer {
	const server = new McpServer(
		{ name: "maina", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	if (options?.allTools) {
		// Register everything upfront
		registerCoreTools(server);
		registerExtendedTools(server);
	} else {
		// Progressive: core tools + list_tools meta-tool
		registerCoreTools(server);
		registerExtendedTools(server); // Still register all — but list_tools helps agents discover them
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
