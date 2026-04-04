/**
 * Review tools — two-stage PR review for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerReviewTools(server: McpServer): void {
	server.tool(
		"reviewCode",
		"Run two-stage review (spec compliance + code quality) on a diff",
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

				// Record feedback for RL loop — review outcome feeds A/B test
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
