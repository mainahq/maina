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
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
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
							),
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
				const { detectSlop } = await import("@maina/core");
				const result = await detectSlop(files, { cwd: process.cwd() });
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
