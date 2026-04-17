/**
 * Context tools — assembles codebase context and conventions for MCP clients.
 *
 * MCP tool results must fit within the host's context window alongside the
 * conversation. We use a smaller budget (30K tokens) and hard-cap output
 * at MAX_MCP_OUTPUT_CHARS to prevent token limit errors.
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

/**
 * Hard cap on MCP tool output in characters. MCP results are injected into
 * the host's conversation context, so they must be much smaller than the
 * full model context window. 50K chars ≈ 14K tokens.
 */
const MAX_MCP_OUTPUT_CHARS = 50_000;

/**
 * Context window budget for MCP calls (in tokens). Much smaller than the
 * default 200K since MCP output shares space with the conversation.
 */
const MCP_CONTEXT_WINDOW = 30_000;

function truncateForMcp(text: string): string {
	if (text.length <= MAX_MCP_OUTPUT_CHARS) return text;
	const truncated = text.slice(0, MAX_MCP_OUTPUT_CHARS);
	const lastNewline = truncated.lastIndexOf("\n");
	const cutPoint =
		lastNewline > MAX_MCP_OUTPUT_CHARS * 0.8
			? lastNewline
			: MAX_MCP_OUTPUT_CHARS;
	return `${truncated.slice(0, cutPoint)}\n\n[… truncated — output exceeded ${MAX_MCP_OUTPUT_CHARS} character MCP limit]`;
}

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
					modeOverride: "focused",
					modelContextWindow: MCP_CONTEXT_WINDOW,
				});
				const durationMs = Date.now() - start;

				const output = truncateForMcp(result.text);

				captureResult({
					tool: "getContext",
					input: { command },
					output,
					durationMs,
					mainaDir,
				});

				const response = JSON.stringify({
					data: {
						context: output,
						tokens: result.tokens,
						mode: result.mode,
						layers: result.layers,
					},
					error: null,
					meta: {
						durationMs,
						command,
						truncated: output.length < result.text.length,
					},
				});
				return {
					content: [{ type: "text" as const, text: response }],
				};
			} catch (e) {
				const response = JSON.stringify({
					data: null,
					error: e instanceof Error ? e.message : String(e),
					meta: { command },
				});
				return {
					content: [{ type: "text" as const, text: response }],
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

				const output = truncateForMcp(built.prompt);

				captureResult({
					tool: "getConventions",
					input: {},
					output,
					durationMs,
					mainaDir,
				});

				const response = JSON.stringify({
					data: { conventions: output, promptHash: built.hash },
					error: null,
					meta: { durationMs, truncated: output.length < built.prompt.length },
				});
				return {
					content: [{ type: "text" as const, text: response }],
				};
			} catch (e) {
				const response = JSON.stringify({
					data: null,
					error: e instanceof Error ? e.message : String(e),
					meta: {},
				});
				return {
					content: [{ type: "text" as const, text: response }],
					isError: true,
				};
			}
		},
	);
}
