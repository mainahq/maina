/**
 * Verify tools — runs verification pipeline and slop detection for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerVerifyTools(server: McpServer): void {
	server.tool(
		"verify",
		"Run verification pipeline on the working tree (staged, unstaged and untracked changes vs the base) or on specified files",
		{ files: z.array(z.string()).optional() },
		async ({ files }) => {
			try {
				const {
					runPipeline,
					captureResult,
					getCurrentBranch,
					getWorkflowId,
					systemProcess,
				} = await import("@mainahq/core");
				const cwd = process.cwd();
				const mainaDir = join(cwd, ".maina");

				const start = Date.now();
				// No files → the pipeline resolves the working-tree scope (#328).
				const result = await runPipeline({
					...(files ? { files } : {}),
					cwd,
					mainaDir,
					env: process.env,
					process: systemProcess,
				});
				const durationMs = Date.now() - start;

				const aiReviewTool = result.tools.find((t) => t.tool === "ai-review");
				const aiSkipped = aiReviewTool?.skipped ?? true;

				const resultJson = JSON.stringify(
					{
						status: result.status,
						passed: result.passed,
						scope: result.scope,
						findings: result.findings,
						...(!result.syntaxPassed && {
							syntaxErrors: result.syntaxErrors,
						}),
						duration: result.duration,
					},
					null,
					2,
				);

				let workflowId: string | undefined;
				try {
					const branch = await getCurrentBranch(cwd);
					workflowId = getWorkflowId(branch);
				} catch {
					/* outside git repo */
				}

				captureResult({
					tool: "verify",
					input: { files: [...result.scope.files] },
					output: resultJson,
					promptHash: result.passed ? "verify-pass" : "verify-fail",
					durationMs,
					mainaDir,
					workflowId,
				});

				if (aiSkipped) {
					return {
						content: [
							{ type: "text" as const, text: resultJson },
							{
								type: "text" as const,
								text: "\n\n---\nNote: AI review was not available (no API key). The deterministic checks above are complete. For AI-powered review, analyze the changed files for: cross-function consistency, missing edge cases, dead branches, API contract violations, and spec compliance.",
							},
						],
					};
				}

				return {
					content: [{ type: "text" as const, text: resultJson }],
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
				const {
					detectSlop,
					createCacheManager,
					captureResult,
					getCurrentBranch,
					getWorkflowId,
				} = await import("@mainahq/core");
				const cwd = process.cwd();
				const mainaDir = join(cwd, ".maina");

				const start = Date.now();
				const cache = createCacheManager(mainaDir);
				const result = await detectSlop(files, { cwd, cache });
				const durationMs = Date.now() - start;

				const resultJson = JSON.stringify(result, null, 2);

				let workflowId: string | undefined;
				try {
					const branch = await getCurrentBranch(cwd);
					workflowId = getWorkflowId(branch);
				} catch {
					/* outside git repo */
				}

				captureResult({
					tool: "checkSlop",
					input: { files },
					output: resultJson,
					durationMs,
					mainaDir,
					workflowId,
				});

				return {
					content: [{ type: "text" as const, text: resultJson }],
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
