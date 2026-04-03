/**
 * Feature tools — test stub generation and cross-artifact analysis for MCP clients.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerFeatureTools(server: McpServer): void {
	server.tool(
		"suggestTests",
		"Generate TDD test stubs from a plan.md file",
		{ planPath: z.string() },
		async ({ planPath }) => {
			try {
				const content = await Bun.file(planPath).text();
				const { generateTestStubs, generateSpecQuestions } = await import(
					"@maina/core"
				);

				// Generate test stubs
				const stubs = generateTestStubs(content, "feature");

				// Generate clarifying questions when ambiguities detected
				const mainaDir = planPath.includes(".maina")
					? planPath.slice(0, planPath.indexOf(".maina") + ".maina".length)
					: ".maina";
				const questionsResult = await generateSpecQuestions(content, mainaDir);

				const parts: Array<{ type: "text"; text: string }> = [
					{ type: "text" as const, text: stubs },
				];

				if (questionsResult.ok && questionsResult.value.length > 0) {
					parts.push({
						type: "text" as const,
						text: `\n\n## Clarifying Questions\n\nThe following ambiguities were detected in the plan. Consider resolving them before implementation:\n\n${JSON.stringify(questionsResult.value, null, 2)}`,
					});
				}

				return { content: parts };
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
		"analyzeFeature",
		"Check spec/plan/tasks consistency for a feature",
		{ featureDir: z.string() },
		async ({ featureDir }) => {
			try {
				const { analyze } = await import("@maina/core");
				const result = analyze(featureDir);
				if (!result.ok) {
					return {
						content: [
							{ type: "text" as const, text: `Error: ${result.error}` },
						],
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(result.value, null, 2),
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
