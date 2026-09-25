/**
 * `pre-merge`: the gate a branch passes before it merges — policy health,
 * verification and review against the base, the feature's spec
 * consistency and its receipts — ending in one verdict.
 */

import {
	arg,
	json,
	list,
	optionalArg,
	type PromptDefinition,
	refArg,
	steps,
	tool,
} from "./shared";

export const preMergePrompt: PromptDefinition = {
	name: "pre-merge",
	title: "Pre-merge gate",
	description:
		"Decide whether a branch is ready to merge: policy status, verification and two-stage review against the base, spec consistency and receipt checks, ending in a single verdict.",
	args: {
		base: refArg(
			"The branch this merges into, e.g. origin/main. Defaults to the repo's base branch.",
		),
		files: optionalArg(
			"Comma-separated files to gate. Defaults to the files changed against the base.",
		),
		feature: optionalArg(
			"Comma-separated feature directories to check, e.g. .maina/features/001-login.",
		),
		receipt: optionalArg("Comma-separated maina receipt JSON files to verify."),
	},
	tools: ["status", "verify", "review_triage", "spec_check", "receipt"],
	render: (args) => {
		const givenBase = arg(args, "base");
		const base = givenBase ? json(givenBase) : "BASE";
		const givenFiles = list(args, "files");
		const files = givenFiles ? json(givenFiles) : "FILES";
		const features = list(args, "feature");
		const receipts = list(args, "receipt");
		const setup = [
			...(givenBase
				? []
				: [
						"Find the branch this merges into (usually `origin/main`) and use it as BASE below.",
					]),
			...(givenFiles
				? []
				: [
						`List the files the branch changes with \`git diff --name-only --diff-filter=d ${givenBase ?? "BASE"}...HEAD\` and use them as FILES below.`,
					]),
		];
		return [
			`Run the pre-merge gate for this branch against ${givenBase ? `\`${givenBase}\`` : "its base branch"}.`,
			...(setup.length > 0 ? ["", ...setup] : []),
			"",
			steps([
				`Call ${tool("status")} and stop if the policy is invalid: report its errors.`,
				`Call ${tool("verify")} with \`files: ${files}\` and \`base: ${base}\`. The gate fails on any failed tool or finding on a changed line; list skipped tools with the reason they give.`,
				`Call ${tool("review_triage")} with \`files: ${files}\` and \`base: ${base}\`. The gate fails on any blocking finding.`,
				...(features
					? [
							`Call ${tool("spec_check")} with \`paths: ${json(features)}\`. The gate fails on a missing file, an acceptance criterion without a task, or a contradiction.`,
						]
					: []),
				...(receipts
					? [
							`Call ${tool("receipt")} with \`paths: ${json(receipts)}\`. The gate fails on a receipt that does not verify.`,
						]
					: []),
			]),
			"",
			"End with one line, READY TO MERGE or NOT READY TO MERGE, then each reason the gate failed (file:line where there is one) and what would fix it. Change no code and merge nothing yourself.",
		].join("\n");
	},
};
