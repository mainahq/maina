/**
 * Feature numbering and directory management.
 *
 * Handles auto-numbering of features, creating feature directories,
 * and scaffolding template files (spec.md, plan.md, tasks.md).
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Result } from "../db/index";
import {
	FEATURE_TEMPLATES,
	type FeatureTemplateKind,
	renderTemplate,
	type TemplateValues,
} from "../prompts/templates/index";
import { toKebabCase } from "../utils";

/**
 * Extract numeric prefix from a feature directory name.
 * Returns the number if the name matches NNN-... pattern, or null.
 */
function extractNumber(name: string): number | null {
	const match = name.match(/^(\d{3})-/);
	if (!match?.[1]) return null;
	return Number.parseInt(match[1], 10);
}

/**
 * Scan `.maina/features/` directory, find the highest existing number prefix,
 * and return the next one zero-padded to 3 digits.
 *
 * Empty dir -> "001". Existing 001, 002 -> "003".
 * If .maina/features/ does not exist, creates it and returns "001".
 */
export async function getNextFeatureNumber(
	mainaDir: string,
): Promise<Result<string>> {
	try {
		const featuresDir = join(mainaDir, ".maina", "features");

		if (!existsSync(featuresDir)) {
			mkdirSync(featuresDir, { recursive: true });
			return { ok: true, value: "001" };
		}

		const entries = readdirSync(featuresDir);
		let maxNumber = 0;

		for (const entry of entries) {
			const fullPath = join(featuresDir, entry);
			// Only consider directories
			try {
				if (!statSync(fullPath).isDirectory()) continue;
			} catch {
				continue;
			}

			const num = extractNumber(entry);
			if (num !== null && num > maxNumber) {
				maxNumber = num;
			}
		}

		const next = (maxNumber + 1).toString().padStart(3, "0");
		return { ok: true, value: next };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Failed to get next feature number: ${message}`,
		};
	}
}

/**
 * Create `.maina/features/{number}-{name}/` directory.
 * Name is converted to kebab-case.
 * Returns the full path to the created directory.
 */
export async function createFeatureDir(
	mainaDir: string,
	number: string,
	name: string,
): Promise<Result<string>> {
	try {
		const kebabName = toKebabCase(name);
		const dirName = `${number}-${kebabName}`;
		const fullPath = join(mainaDir, ".maina", "features", dirName);

		if (existsSync(fullPath)) {
			return {
				ok: false,
				error: `Feature directory already exists: ${fullPath}`,
			};
		}

		mkdirSync(fullPath, { recursive: true });
		return { ok: true, value: fullPath };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Failed to create feature directory: ${message}`,
		};
	}
}

// ─── Design Choices ──────────────────────────────────────────────────────

/**
 * Represents user's design decisions collected during interactive planning.
 * When provided, these enrich the scaffolded templates with concrete choices
 * instead of generic [NEEDS CLARIFICATION] markers.
 */
export interface DesignChoices {
	/** Brief description of what the feature does */
	description?: string;
	/** Architecture pattern chosen (e.g., "repository", "service-layer", "event-driven") */
	pattern?: string;
	/** Key libraries or tools selected */
	libraries?: string[];
	/** Tradeoff decisions made (e.g., "Chose simplicity over performance") */
	tradeoffs?: string[];
	/** Resolved clarifications — questions the user already answered */
	clarifications?: Array<{ question: string; answer: string }>;
}

// ─── Scaffolding ─────────────────────────────────────────────────────────────
// The spec/plan/tasks text lives in `prompts/templates/*.md`, the single
// source of truth; nothing here restates it.

/** The feature name and branch a feature directory implies (`001-name`). */
function templateValues(featureDir: string, name?: string): TemplateValues {
	const branch = basename(featureDir);
	return {
		name: name ?? branch.replace(/^\d{3}-/, ""),
		branch,
	};
}

/**
 * `block` inserted ahead of the first `## <heading>` line of `doc`, or
 * appended when the heading is absent.
 */
function insertBeforeHeading(
	doc: string,
	heading: string,
	block: string,
): string {
	const lines = doc.split("\n");
	const at = lines.findIndex((line) => line.startsWith(`## ${heading}`));
	if (at === -1) return `${doc.trimEnd()}\n\n${block}\n`;
	return [...lines.slice(0, at), block, "", ...lines.slice(at)].join("\n");
}

async function writeFeatureFiles(
	featureDir: string,
	files: Readonly<Record<FeatureTemplateKind, string>>,
): Promise<Result<void>> {
	try {
		if (!existsSync(featureDir)) {
			return {
				ok: false,
				error: `Feature directory does not exist: ${featureDir}`,
			};
		}
		for (const kind of ["spec", "plan", "tasks"] as const) {
			await Bun.write(join(featureDir, `${kind}.md`), files[kind]);
		}
		return { ok: true, value: undefined };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `Failed to scaffold feature: ${message}` };
	}
}

/**
 * Create three template files inside the feature directory, rendered from
 * the shipped templates:
 * - spec.md — WHAT and WHY only
 * - plan.md — HOW only, opening with the constitution gate
 * - tasks.md — WHEN: the phased task list
 */
export async function scaffoldFeature(
	featureDir: string,
): Promise<Result<void>> {
	const values = templateValues(featureDir);
	return writeFeatureFiles(featureDir, {
		spec: renderTemplate(FEATURE_TEMPLATES.spec, values),
		plan: renderTemplate(FEATURE_TEMPLATES.plan, values),
		tasks: renderTemplate(FEATURE_TEMPLATES.tasks, values),
	});
}

/** The spec template with the user's WHAT/WHY choices filled in. */
function buildEnrichedSpec(values: TemplateValues, choices: DesignChoices) {
	let spec = renderTemplate(FEATURE_TEMPLATES.spec, values);
	if (choices.description) {
		spec = insertBeforeHeading(
			spec,
			"User journeys",
			`## Problem statement\n\n${choices.description}\n`,
		);
	}
	if (choices.tradeoffs && choices.tradeoffs.length > 0) {
		const lines = choices.tradeoffs.map((t) => `- ${t}`).join("\n");
		spec = insertBeforeHeading(
			spec,
			"Assumptions",
			`## Design decisions\n\n${lines}\n`,
		);
	}
	if (choices.clarifications && choices.clarifications.length > 0) {
		const lines = choices.clarifications
			.map((c) => `- Q: ${c.question} → A: ${c.answer}`)
			.join("\n");
		spec = `${spec.trimEnd()}\n\n## Clarifications\n\n${lines}\n`;
	}
	return spec;
}

/** The plan template with the user's HOW choices filled in. */
function buildEnrichedPlan(values: TemplateValues, choices: DesignChoices) {
	const plan = renderTemplate(FEATURE_TEMPLATES.plan, values);
	const lines: string[] = [];
	if (choices.pattern) lines.push(`- Pattern: **${choices.pattern}**`);
	for (const lib of choices.libraries ?? []) lines.push(`- Library: ${lib}`);
	if (lines.length === 0) return plan;
	return insertBeforeHeading(
		plan,
		"Module map",
		`## Design choices\n\n${lines.join("\n")}\n`,
	);
}

/**
 * Scaffold feature files enriched with user's design choices.
 * Falls back to the plain templates for any missing choices.
 */
export async function scaffoldFeatureWithContext(
	featureDir: string,
	name: string,
	choices: DesignChoices,
): Promise<Result<void>> {
	const values = templateValues(featureDir, name);
	return writeFeatureFiles(featureDir, {
		spec: buildEnrichedSpec(values, choices),
		plan: buildEnrichedPlan(values, choices),
		tasks: renderTemplate(FEATURE_TEMPLATES.tasks, values),
	});
}
