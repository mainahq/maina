/**
 * `spec_check`: spec/plan/tasks consistency for explicit feature
 * directories (missing files, uncovered criteria, orphaned tasks, WHAT/HOW
 * leaks, contradictions).
 */

import { z } from "zod";
import {
	capped,
	defineTool,
	ok,
	plural,
	repoRelative,
	rootInput,
} from "./shared";

const finding = z.object({
	severity: z.enum(["error", "warning", "info"]),
	category: z.string(),
	message: z.string(),
	file: z.string().optional(),
	line: z.number().optional(),
});

const counts = z.object({
	errors: z.number(),
	warnings: z.number(),
	info: z.number(),
});

const data = z.object({
	passed: z.boolean(),
	summary: counts,
	reports: z.array(
		z.object({
			path: z.string(),
			findings: z.array(finding),
			summary: counts,
		}),
	),
});

export const specCheckTool = defineTool({
	name: "spec_check",
	description:
		"Check explicit feature directories (spec.md, plan.md, tasks.md) for consistency: missing files, acceptance criteria without tasks, orphaned tasks, WHAT/HOW separation leaks and contradictions.",
	readOnly: true,
	input: {
		root: rootInput,
		paths: z
			.array(z.string())
			.min(1)
			.describe(
				"Feature directories, e.g. .maina/features/001-login: repo-relative, or absolute inside the root.",
			),
	},
	data,
	run: async (args, { root, runtime }) => {
		const paths = repoRelative(root, args.paths);
		if (!paths.ok) return paths;
		const result = await runtime.specCheck({ root, paths: paths.value });
		if (!result.ok) return result;
		const reports = result.value.map(({ path, report }) => ({
			path,
			findings: report.findings.map((f) => ({
				severity: f.severity,
				category: f.category,
				message: f.message,
				...(f.file !== undefined ? { file: f.file } : {}),
				...(f.line !== undefined ? { line: f.line } : {}),
			})),
			summary: {
				errors: report.summary.errors,
				warnings: report.summary.warnings,
				info: report.summary.info,
			},
		}));
		const summary = reports.reduce(
			(sum, r) => ({
				errors: sum.errors + r.summary.errors,
				warnings: sum.warnings + r.summary.warnings,
				info: sum.info + r.summary.info,
			}),
			{ errors: 0, warnings: 0, info: 0 },
		);
		const passed = summary.errors === 0;
		const text = [
			`spec_check: ${passed ? "passed" : "FAILED"}: ${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")} across ${plural(reports.length, "feature")}`,
			...reports.flatMap((r) => [
				`${r.path}:`,
				...capped(
					r.findings
						.filter((f) => f.severity !== "info")
						.map((f) => `- [${f.severity}] ${f.category}: ${f.message}`),
				),
			]),
		].join("\n");
		return ok({ data: { passed, summary, reports }, summary: text });
	},
});
