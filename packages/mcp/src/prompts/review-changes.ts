/**
 * `review-changes`: walks the host through reviewing a change set — its
 * blast radius, the verification pipeline, the two-stage review and a
 * typed check of doubtful findings — and asks for a triaged report.
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

export const reviewChangesPrompt: PromptDefinition = {
	name: "review-changes",
	title: "Review changes",
	description:
		"Review a change set with maina: blast radius, verification, two-stage review and a triaged report of blocking and advisory findings on the changed lines.",
	args: {
		base: refArg("Ref to review the changes against. Defaults to HEAD."),
		files: optionalArg(
			"Comma-separated files to review. Defaults to the files changed against the base.",
		),
		focus: optionalArg(
			"What to pay particular attention to, e.g. error handling.",
		),
	},
	tools: ["impact", "verify", "review_triage", "decide"],
	render: (args) => {
		const base = arg(args, "base") ?? "HEAD";
		const focus = arg(args, "focus");
		const given = list(args, "files");
		const files = given ? json(given) : "FILES";
		const scope = given
			? `Review these files: ${files}.`
			: `First list the changed files with \`git diff --name-only ${base}\` (plus any untracked files you created) and use that list as FILES below.`;
		return [
			`Review the changes against \`${base}\`${focus ? `, paying particular attention to ${focus}` : ""}.`,
			"",
			scope,
			"",
			steps([
				`Call ${tool("impact")} with \`files: ${files}\` to see which callers, dependent files and tests the change can reach. Note a high blast score.`,
				`Call ${tool("verify")} with \`files: ${files}\` and \`base: ${json(base)}\`. A failed tool or a finding on a changed line is a problem to report; for a skipped tool, report the reason it gives instead of counting it as a pass.`,
				`Call ${tool("review_triage")} with \`files: ${files}\` and \`base: ${json(base)}\` for the two-stage review: spec compliance, then code quality.`,
				`For a finding you doubt, call ${tool("decide")} with the decision type \`finding.real\`, one \`bool\` question per finding, and the finding's text in \`state.untrusted\`.`,
			]),
			"",
			"Report blocking findings first (file:line, why it matters, the fix), then advisory ones, then the tests the impact results say to re-run. Report only findings on changed lines, and change no code unless asked.",
		].join("\n");
	},
};
