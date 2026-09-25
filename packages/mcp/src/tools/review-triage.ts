/**
 * `review_triage`: the two-stage review (spec compliance, then code
 * quality) over an explicit diff or explicit files, triaged into what
 * blocks a merge, what is advisory and what is informational.
 */

import type { PrReviewFinding } from "@mainahq/core";
import { z } from "zod";
import {
	capped,
	checkRef,
	defineTool,
	filesInput,
	invalid,
	ok,
	optionalRepoRelative,
	rootInput,
} from "./shared";

const finding = z.object({
	stage: z.enum(["spec-compliance", "code-quality"]),
	severity: z.enum(["error", "warning", "info"]),
	message: z.string(),
	file: z.string().optional(),
	line: z.number().optional(),
});

const data = z.object({
	passed: z.boolean(),
	delegated: z.boolean(),
	stages: z.object({
		specCompliance: z.boolean(),
		codeQuality: z.boolean().nullable(),
	}),
	counts: z.object({
		blocking: z.number(),
		advisory: z.number(),
		info: z.number(),
	}),
	blocking: z.array(finding),
	advisory: z.array(finding),
	info: z.array(finding),
});

type Finding = z.infer<typeof finding>;

const toFinding = (f: PrReviewFinding): Finding => ({
	stage: f.stage,
	severity: f.severity,
	message: f.message,
	...(f.file !== undefined ? { file: f.file } : {}),
	...(f.line !== undefined ? { line: f.line } : {}),
});

const describeFinding = (f: Finding): string =>
	`- ${f.file ? `${f.file}${f.line ? `:${f.line}` : ""} ` : ""}${f.message}`;

export const reviewTriageTool = defineTool({
	name: "review_triage",
	description:
		"Two-stage review (spec compliance, then code quality) of an explicit diff or of explicit files against a base ref, triaged into blocking, advisory and info findings.",
	readOnly: true,
	input: {
		root: rootInput,
		diff: z
			.string()
			.optional()
			.describe(
				"A unified diff to review. Omit to diff `files` against `base`.",
			),
		files: filesInput.describe(
			"Files to review: without `diff` they are diffed against `base`; with it they narrow the triage to findings in these files.",
		),
		base: z
			.string()
			.optional()
			.describe(
				"Ref to diff `files` against when no `diff` is given. Defaults to HEAD.",
			),
		planContent: z
			.string()
			.optional()
			.describe("The feature's plan.md, for the spec-compliance stage."),
	},
	data,
	run: async (args, { root, runtime }) => {
		// A blank diff counts as absent: reviewing it would pass vacuously.
		const diff = args.diff?.trim() ? args.diff : undefined;
		if (diff === undefined && !args.files?.length) {
			return invalid("review_triage needs a `diff` or `files`");
		}
		const files = optionalRepoRelative(root, args.files);
		if (!files.ok) return files;
		const base = checkRef(args.base);
		if (!base.ok) return base;
		const result = await runtime.review({
			root,
			...(diff !== undefined ? { diff } : {}),
			...(files.value !== undefined ? { files: files.value } : {}),
			...(base.value !== undefined ? { base: base.value } : {}),
			...(args.planContent !== undefined
				? { planContent: args.planContent }
				: {}),
		});
		if (!result.ok) return result;
		const { result: review, delegated } = result.value;
		const scope = files.value === undefined ? undefined : new Set(files.value);
		const findings = [
			...review.stage1.findings,
			...(review.stage2?.findings ?? []),
		]
			.map(toFinding)
			.filter(
				(f) => scope === undefined || f.file === undefined || scope.has(f.file),
			);
		const blocking = findings.filter((f) => f.severity === "error");
		const advisory = findings.filter((f) => f.severity === "warning");
		const info = findings.filter((f) => f.severity === "info");
		const passed = blocking.length === 0;
		const summary = [
			`review_triage: ${passed ? "passed" : "BLOCKED"} (${blocking.length} blocking, ${advisory.length} advisory, ${info.length} info)`,
			...(delegated
				? [
						"AI review was delegated: review the diff in the host for logic and spec gaps.",
					]
				: []),
			...(blocking.length > 0
				? ["blocking:", ...capped(blocking.map(describeFinding))]
				: []),
			...(advisory.length > 0
				? ["advisory:", ...capped(advisory.map(describeFinding))]
				: []),
		].join("\n");
		return ok({
			data: {
				passed,
				delegated,
				stages: {
					specCompliance: review.stage1.passed,
					codeQuality: review.stage2?.passed ?? null,
				},
				counts: {
					blocking: blocking.length,
					advisory: advisory.length,
					info: info.length,
				},
				blocking,
				advisory,
				info,
			},
			summary,
		});
	},
});
