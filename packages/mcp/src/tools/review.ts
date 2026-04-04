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
					recordFeedbackAsync,
					getWorkflowId,
					getCurrentBranch,
				} = await import("@maina/core");
				const mainaDir = join(process.cwd(), ".maina");
				const result = await runTwoStageReview({
					diff,
					planContent,
					mainaDir,
				});

				// Record feedback for RL loop
				const branch = await getCurrentBranch(process.cwd());
				const workflowId = getWorkflowId(branch);
				recordFeedbackAsync(mainaDir, {
					promptHash: "review-mcp",
					task: "review",
					accepted: result.passed,
					timestamp: new Date().toISOString(),
					workflowStep: "review",
					workflowId,
				});

				// Check if any findings contain delegation prompts
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

				if (hasDelegation) {
					// Include instruction for host agent
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify(result, null, 2),
							},
							{
								type: "text" as const,
								text: "\n\n---\nNote: AI review was not available (no API key). The deterministic checks above are complete. For AI-powered review, analyze the diff above for: cross-function consistency, missing edge cases, dead branches, API contract violations, and spec compliance.",
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(result, null, 2),
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
