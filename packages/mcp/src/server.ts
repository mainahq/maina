/**
 * MCP Server — exposes Maina engines as tools for Claude Code, Cursor, and other IDE agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerContextTools } from "./tools/context";
import { registerExplainTools } from "./tools/explain";
import { registerFeatureTools } from "./tools/features";
import { registerReviewTools } from "./tools/review";
import { registerVerifyTools } from "./tools/verify";
import { registerWikiTools } from "./tools/wiki";

export function createMcpServer(): McpServer {
	const server = new McpServer(
		{ name: "maina", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	registerContextTools(server);
	registerVerifyTools(server);
	registerFeatureTools(server);
	registerExplainTools(server);
	registerReviewTools(server);
	registerWikiTools(server);

	return server;
}

export async function startServer(): Promise<void> {
	// Signal to core modules that we're running as MCP — suppress all stderr output
	process.env.MAINA_MCP_SERVER = "1";

	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
