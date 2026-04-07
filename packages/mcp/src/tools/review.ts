/**
 * Review tools — two-stage PR review for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerReviewTools(server: McpServer): void {
	server.tool(
		"reviewCode",
		"Run two-stage review (spec compliance + code quality) on a diff. In host mode, returns AI prompts for the host to process.",
		{ diff: z.string(), planContent: z.string().optional() },
		async ({ diff, planContent }) => {
			try {
				const {
					runTwoStageReview,
					captureResult,
					getCachedResult,
					getCurrentBranch,
					getWorkflowId,
				} = await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");
				const input = { diff, planContent };

				// Check cache — same diff = same review
				const cached = getCachedResult("reviewCode", input, mainaDir);
				if (cached !== null) {
					return {
						content: [{ type: "text" as const, text: cached }],
					};
				}

				const start = Date.now();
				const result = await runTwoStageReview({
					diff,
					planContent,
					mainaDir,
				});
				const durationMs = Date.now() - start;

				const allFindings = [
					...result.stage1.findings,
					...(result.stage2?.findings ?? []),
				];
				const hasDelegation = allFindings.some(
					(f) =>
						typeof f.message === "string" &&
						(f.message.includes("AI review:") ||
							f.message.includes("[HOST_DELEGATION]")),
				);

				const resultJson = JSON.stringify(result, null, 2);

				// Capture for flywheel (skip delegation results — AI may be available next time)
				if (!hasDelegation) {
					let workflowId: string | undefined;
					try {
						const branch = await getCurrentBranch(process.cwd());
						workflowId = getWorkflowId(branch);
					} catch {
						/* outside git repo */
					}

					captureResult({
						tool: "reviewCode",
						input,
						output: resultJson,
						promptHash: "review-mcp",
						durationMs,
						mainaDir,
						workflowId,
					});
				}

				if (hasDelegation) {
					return {
						content: [
							{ type: "text" as const, text: resultJson },
							{
								type: "text" as const,
								text: "\n\n---\nNote: AI review was not available (no API key). The deterministic checks above are complete. For AI-powered review, analyze the diff above for: cross-function consistency, missing edge cases, dead branches, API contract violations, and spec compliance.",
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
}
