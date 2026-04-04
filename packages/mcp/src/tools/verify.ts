/**
 * Verify tools — runs verification pipeline and slop detection for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerVerifyTools(server: McpServer): void {
	server.tool(
		"verify",
		"Run verification pipeline on staged or specified files",
		{ files: z.array(z.string()).optional() },
		async ({ files }) => {
			try {
				const { runPipeline, getStagedFiles } = await import("@maina/core");
				const cwd = process.cwd();
				const targetFiles = files ?? (await getStagedFiles(cwd));
				const result = await runPipeline({
					files: targetFiles,
					cwd,
					mainaDir: join(cwd, ".maina"),
				});

				const aiReviewTool = result.tools.find((t) => t.tool === "ai-review");
				const aiSkipped = aiReviewTool?.skipped ?? true;

				const resultJson = JSON.stringify(
					{
						passed: result.passed,
						findings: result.findings,
						...(!result.syntaxPassed && {
							syntaxErrors: result.syntaxErrors,
						}),
						duration: result.duration,
					},
					null,
					2,
				);

				if (aiSkipped) {
					return {
						content: [
							{
								type: "text" as const,
								text: resultJson,
							},
							{
								type: "text" as const,
								text: "\n\n---\nNote: AI review was not available (no API key). The deterministic checks above are complete. For AI-powered review, analyze the changed files for: cross-function consistency, missing edge cases, dead branches, API contract violations, and spec compliance.",
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: resultJson,
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

	server.tool(
		"checkSlop",
		"Check code for AI-generated slop patterns",
		{ files: z.array(z.string()) },
		async ({ files }) => {
			try {
				const { detectSlop, createCacheManager } = await import("@maina/core");
				const cwd = process.cwd();
				const cache = createCacheManager(join(cwd, ".maina"));
				const result = await detectSlop(files, { cwd, cache });
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
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
