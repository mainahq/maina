/**
 * `plan-feature`: turns a feature description into a maina feature
 * directory — spec.md for WHAT and WHY, plan.md for HOW, tasks.md — grounded
 * in the code it touches and checked for consistency.
 */

import {
	arg,
	json,
	optionalArg,
	type PromptDefinition,
	requiredArg,
	steps,
	tool,
} from "./shared";

export const planFeaturePrompt: PromptDefinition = {
	name: "plan-feature",
	title: "Plan a feature",
	description:
		"Plan a feature with maina: gather the code it touches, write spec.md (WHAT/WHY), plan.md (HOW) and tasks.md in a feature directory, then check them for consistency.",
	args: {
		description: requiredArg(
			"What the feature should do, in a sentence or two.",
		),
		feature: optionalArg(
			"The feature directory to write, e.g. .maina/features/007-dark-mode. Defaults to the next number under .maina/features.",
		),
	},
	tools: ["context", "impact", "spec_check"],
	render: (args) => {
		const description = arg(args, "description") ?? "";
		const given = arg(args, "feature");
		const dir = given ?? "DIR";
		return [
			"Plan this feature:",
			"",
			description
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n"),
			"",
			given
				? `Write the plan in \`${given}\`.`
				: "Pick the next free number under `.maina/features/` (e.g. `.maina/features/007-short-name`) and use it as DIR below.",
			"",
			steps([
				`Call ${tool("context")} with \`query: ${json(description)}\` to find the code the feature touches.`,
				`Call ${tool("impact")} with the files that context returned to see their callers, dependent files and covering tests.`,
				`Write \`${dir}/spec.md\`: WHAT the feature does and WHY, with measurable acceptance criteria and no implementation detail.`,
				`Write \`${dir}/plan.md\`: HOW to build it, grounded in the files and symbols above, including the tests to write first.`,
				`Write \`${dir}/tasks.md\`: small tasks, each tied to an acceptance criterion.`,
				`Call ${tool("spec_check")} with \`paths: ${given ? json([given]) : "[DIR]"}\` and fix what it reports until it is clean.`,
			]),
			"",
			"Mark anything the description leaves open with [NEEDS CLARIFICATION] instead of guessing, and list those questions at the end. Write no production code yet.",
		].join("\n");
	},
};
