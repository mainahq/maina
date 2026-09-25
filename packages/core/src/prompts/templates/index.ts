/**
 * The spec → plan → tasks templates: the single source of truth for every
 * feature scaffold and for the checks that grade against the template's
 * shape. Imported as text so bunup inlines them into the package.
 */

import plan from "./plan-template.md" with { type: "text" };
import spec from "./spec-template.md" with { type: "text" };
import tasks from "./tasks-template.md" with { type: "text" };

export type FeatureTemplateKind = "spec" | "plan" | "tasks";

export const FEATURE_TEMPLATES: Readonly<Record<FeatureTemplateKind, string>> =
	{ spec, plan, tasks };

export type TemplateValues = Readonly<{
	/** The feature's name, for `[FEATURE NAME]`. */
	name: string;
	/** The feature directory / branch name, for `[###-feature-name]`. */
	branch: string;
}>;

/** A template with its feature name and branch placeholders filled. */
export function renderTemplate(
	template: string,
	values: TemplateValues,
): string {
	return template
		.replaceAll("[FEATURE NAME]", values.name)
		.replaceAll("[###-feature-name]", values.branch);
}

/**
 * The `## ` headings a template marks `*(mandatory)*`, in order, without the
 * marker: what a document written from that template must contain.
 */
export function mandatorySections(template: string): readonly string[] {
	const sections: string[] = [];
	for (const line of template.split("\n")) {
		const match = line.match(/^##\s+(.+?)\s+\*\(mandatory\)\*\s*$/);
		if (match?.[1]) sections.push(match[1]);
	}
	return sections;
}
