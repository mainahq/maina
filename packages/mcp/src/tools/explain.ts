/**
 * Explain tools — dependency diagrams and module summaries for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerExplainTools(server: McpServer): void {
	server.tool(
		"explainModule",
		"Get Mermaid dependency diagram for a directory",
		{ scope: z.string().optional() },
		async ({ scope }) => {
			try {
				const { generateDependencyDiagram } = await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");
				const diagram = generateDependencyDiagram(mainaDir, { scope });
				return {
					content: [
						{
							type: "text" as const,
							text: diagram.ok ? diagram.value : "No dependency data",
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
