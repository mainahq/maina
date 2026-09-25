/**
 * `verify`: the verification pipeline over explicit files, with the status
 * of every tool and why each skipped tool was skipped (#421), so an MCP
 * client sees the same picture as `maina verify --json`.
 */

import type { DetectedTool, PipelineResult, ToolReport } from "@mainahq/core";
import { z } from "zod";
import {
	capped,
	defineTool,
	filesInput,
	ok,
	optionalRepoRelative,
	plural,
	rootInput,
} from "./shared";

const severity = z.enum(["error", "warning", "info"]);

const finding = z.object({
	tool: z.string(),
	file: z.string(),
	line: z.number(),
	column: z.number().optional(),
	message: z.string(),
	severity,
	ruleId: z.string().optional(),
});

const toolStatus = z.object({
	tool: z.string(),
	status: z.enum(["passed", "failed", "skipped"]),
	/** Findings this tool contributed after the diff-only filter. */
	findings: z.number(),
	durationMs: z.number(),
	reason: z.string().optional(),
});

const syntaxError = z.object({
	file: z.string(),
	line: z.number(),
	column: z.number(),
	message: z.string(),
	severity: z.enum(["error", "warning"]),
});

const data = z.object({
	/**
	 * `passed` needs a tool that ran on a file in scope; an empty scope, or
	 * one no tool could check, is `skipped`, never `passed` (#328).
	 */
	status: z.enum(["passed", "failed", "skipped"]),
	passed: z.boolean(),
	/** The files checked: the explicit list, or the working-tree changes. */
	scope: z.object({
		kind: z.enum(["working-tree", "staged", "range", "files"]),
		files: z.array(z.string()),
	}),
	syntaxPassed: z.boolean(),
	syntaxErrors: z.array(syntaxError).optional(),
	findings: z.array(finding),
	hiddenCount: z.number(),
	tools: z.array(toolStatus),
	durationMs: z.number(),
});

type ToolStatus = z.infer<typeof toolStatus>;

/** Why a skipped tool did not run, in words a user can act on. */
function skipReason(
	report: ToolReport,
	detected: readonly DetectedTool[],
): string {
	if (report.notice) return report.notice;
	const tool = detected.find((d) => d.name === report.tool);
	if (tool !== undefined && !tool.available) {
		return `${report.tool} is not installed`;
	}
	if (report.tool === "ai-review") {
		return "no AI model is configured; review the diff in the host instead";
	}
	return `${report.tool} does not apply to these files`;
}

/** One status per tool the pipeline ran or skipped, in pipeline order. */
function toolStatuses(result: PipelineResult): ToolStatus[] {
	return result.tools.map((report) => {
		const shown = result.findings.filter((f) => f.tool === report.tool);
		const base = {
			tool: report.tool,
			findings: shown.length,
			durationMs: report.duration,
		};
		if (report.skipped) {
			return {
				...base,
				status: "skipped" as const,
				reason: skipReason(report, result.detectedTools),
			};
		}
		const failed = shown.some((f) => f.severity === "error");
		return {
			...base,
			status: failed ? ("failed" as const) : ("passed" as const),
		};
	});
}

function summarize(
	result: PipelineResult,
	tools: readonly ToolStatus[],
): string {
	const verdict =
		result.status === "failed" ? "FAILED" : result.status;
	const head = `verify: ${verdict} on ${plural(result.scope.files.length, "file")} with ${plural(result.findings.length, "finding")}${
		result.hiddenCount > 0 ? ` (${result.hiddenCount} pre-existing hidden)` : ""
	} in ${result.duration}ms`;
	const ran = tools.filter((t) => t.status !== "skipped");
	const skipped = tools.filter((t) => t.status === "skipped");
	const lines = [head];
	if (ran.length > 0) {
		lines.push(
			`tools: ${ran.map((t) => `${t.tool} ${t.status}${t.findings > 0 ? ` (${t.findings})` : ""}`).join(", ")}`,
		);
	}
	if (skipped.length > 0) {
		lines.push("skipped:", ...skipped.map((t) => `- ${t.tool}: ${t.reason}`));
	}
	if (!result.syntaxPassed) {
		lines.push(
			"syntax errors:",
			...capped(
				(result.syntaxErrors ?? []).map(
					(e) => `- ${e.file}:${e.line}:${e.column} ${e.message}`,
				),
			),
		);
	}
	if (result.findings.length > 0) {
		lines.push(
			"findings:",
			...capped(
				result.findings.map(
					(f) =>
						`- ${f.file}:${f.line} [${f.severity}] ${f.tool}: ${f.message}`,
				),
			),
		);
	}
	return lines.join("\n");
}

export const verifyTool = defineTool({
	name: "verify",
	description:
		"Run the verification pipeline (syntax guard, deterministic tools, diff-only filter) on the working tree or explicit files. Returns passed/failed/skipped (never passed on an empty scope), the files checked, findings on changed lines, and each tool's status with the reason any tool was skipped.",
	readOnly: true,
	input: {
		root: rootInput,
		files: filesInput.describe(
			"Files to verify: repo-relative, or absolute inside the root. Omit to verify the working tree (staged, unstaged and untracked changes vs the base); an empty list verifies nothing.",
		),
		base: z
			.string()
			.optional()
			.describe(
				"Base ref for the diff-only filter. Defaults to the repo's base branch.",
			),
	},
	data,
	run: async (args, { root, runtime }) => {
		const files = optionalRepoRelative(root, args.files);
		if (!files.ok) return files;
		const result = await runtime.verify({
			root,
			...(files.value !== undefined ? { files: files.value } : {}),
			...(args.base !== undefined ? { base: args.base } : {}),
		});
		if (!result.ok) return result;
		const pipeline = result.value;
		const tools = toolStatuses(pipeline);
		return ok({
			data: {
				status: pipeline.status,
				passed: pipeline.passed,
				scope: {
					kind: pipeline.scope.kind,
					files: [...pipeline.scope.files],
				},
				syntaxPassed: pipeline.syntaxPassed,
				...(pipeline.syntaxErrors !== undefined
					? {
							syntaxErrors: pipeline.syntaxErrors.map((e) => ({
								file: e.file,
								line: e.line,
								column: e.column,
								message: e.message,
								severity: e.severity,
							})),
						}
					: {}),
				findings: pipeline.findings.map((f) => ({
					tool: f.tool,
					file: f.file,
					line: f.line,
					...(f.column !== undefined ? { column: f.column } : {}),
					message: f.message,
					severity: f.severity,
					...(f.ruleId !== undefined ? { ruleId: f.ruleId } : {}),
				})),
				hiddenCount: pipeline.hiddenCount,
				tools,
				durationMs: pipeline.duration,
			},
			summary: summarize(pipeline, tools),
		});
	},
});
