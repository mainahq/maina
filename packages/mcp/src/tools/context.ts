/**
 * Context tools — assembles codebase context and conventions for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const COMMANDS = [
	"commit",
	"verify",
	"context",
	"review",
	"plan",
	"explain",
	"design",
	"ticket",
	"analyze",
	"pr",
] as const;

export function registerContextTools(server: McpServer): void {
	server.tool(
		"getContext",
		"Get focused codebase context for a command",
		{ command: z.enum(COMMANDS) },
		async ({ command }) => {
			try {
				const { assembleContext } = await import("@mainahq/core");
				const result = await assembleContext(command, {
					repoRoot: process.cwd(),
					mainaDir: join(process.cwd(), ".maina"),
				});
				return { content: [{ type: "text" as const, text: result.text }] };
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

	server.tool(
		"getConventions",
		"Get project constitution and conventions",
		{},
		async () => {
			try {
				const { buildSystemPrompt } = await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");
				const built = await buildSystemPrompt("review", mainaDir, {});
				return { content: [{ type: "text" as const, text: built.prompt }] };
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
