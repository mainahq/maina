/**
 * Feature tools — test stub generation and cross-artifact analysis for MCP clients.
 */

import { join } from "node:path";
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
				const { generateTestStubs, generateSpecQuestions, captureResult } =
					await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const stubs = generateTestStubs(content, "feature");
				const questionsResult = await generateSpecQuestions(
					content,
					planPath.includes(".maina")
						? planPath.slice(0, planPath.indexOf(".maina") + ".maina".length)
						: ".maina",
				);
				const durationMs = Date.now() - start;

				const parts: Array<{ type: "text"; text: string }> = [
					{ type: "text" as const, text: stubs },
				];

				if (questionsResult.ok && questionsResult.value.length > 0) {
					parts.push({
						type: "text" as const,
						text: `\n\n## Clarifying Questions\n\nThe following ambiguities were detected in the plan. Consider resolving them before implementation:\n\n${JSON.stringify(questionsResult.value, null, 2)}`,
					});
				}

				const fullOutput = parts.map((p) => p.text).join("");
				captureResult({
					tool: "suggestTests",
					input: { planPath },
					output: fullOutput,
					durationMs,
					mainaDir,
				});

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
				const { analyze, captureResult } = await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const result = analyze(featureDir);
				const durationMs = Date.now() - start;

				if (!result.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Error: ${result.error}`,
							},
						],
						isError: true,
					};
				}

				const resultJson = JSON.stringify(result.value, null, 2);
				captureResult({
					tool: "analyzeFeature",
					input: { featureDir },
					output: resultJson,
					durationMs,
					mainaDir,
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
