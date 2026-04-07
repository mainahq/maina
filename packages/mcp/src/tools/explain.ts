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
				const { generateDependencyDiagram, captureResult } = await import(
					"@mainahq/core"
				);
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const diagram = generateDependencyDiagram(mainaDir, { scope });
				const durationMs = Date.now() - start;

				const output = diagram.ok ? diagram.value : "No dependency data";

				captureResult({
					tool: "explainModule",
					input: { scope },
					output,
					durationMs,
					mainaDir,
				});

				return {
					content: [{ type: "text" as const, text: output }],
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
