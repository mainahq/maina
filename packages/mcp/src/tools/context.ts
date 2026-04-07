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
				const { assembleContext, captureResult } = await import(
					"@mainahq/core"
				);
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const result = await assembleContext(command, {
					repoRoot: process.cwd(),
					mainaDir,
				});
				const durationMs = Date.now() - start;

				captureResult({
					tool: "getContext",
					input: { command },
					output: result.text,
					durationMs,
					mainaDir,
				});

				return {
					content: [{ type: "text" as const, text: result.text }],
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

	server.tool(
		"getConventions",
		"Get project constitution and conventions",
		{},
		async () => {
			try {
				const { buildSystemPrompt, captureResult } = await import(
					"@mainahq/core"
				);
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const built = await buildSystemPrompt("review", mainaDir, {});
				const durationMs = Date.now() - start;

				captureResult({
					tool: "getConventions",
					input: {},
					output: built.prompt,
					durationMs,
					mainaDir,
				});

				return {
					content: [{ type: "text" as const, text: built.prompt }],
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
