/**
 * Feature numbering and directory management.
 *
 * Handles auto-numbering of features, creating feature directories,
 * and scaffolding template files (spec.md, plan.md, tasks.md).
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";

/**
 * Convert a string to kebab-case.
 * Handles: spaces, camelCase, PascalCase, underscores.
 */
function toKebabCase(input: string): string {
	return (
		input
			// Insert hyphen before uppercase letters in camelCase/PascalCase
			.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
			// Replace spaces, underscores, and multiple hyphens with single hyphen
			.replace(/[\s_]+/g, "-")
			// Remove non-alphanumeric characters except hyphens
			.replace(/[^a-z0-9-]/gi, "")
			// Collapse multiple hyphens
			.replace(/-+/g, "-")
			// Trim leading/trailing hyphens
			.replace(/^-|-$/g, "")
			.toLowerCase()
	);
}

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

const SPEC_TEMPLATE = `# Feature Name

> WHAT and WHY only — no implementation details here.

## User Stories

- As a [role], I want [capability] so that [benefit].

## Acceptance Criteria

- [ ] [NEEDS CLARIFICATION] Define acceptance criteria.

## [NEEDS CLARIFICATION]

- List any open questions or ambiguities here.
`;

const PLAN_TEMPLATE = `# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- [NEEDS CLARIFICATION] Describe the technical approach.

## Tasks

- [ ] [NEEDS CLARIFICATION] Break down implementation tasks.
`;

const TASKS_TEMPLATE = `# Task Breakdown

## Tasks

- [ ] [NEEDS CLARIFICATION] Define tasks with estimates.

## Dependencies

- [NEEDS CLARIFICATION] List any blocking dependencies.

## Notes

- [NEEDS CLARIFICATION] Additional context or constraints.
`;

/**
 * Create three template files inside the feature directory:
 * - spec.md — WHAT and WHY only
 * - plan.md — HOW only
 * - tasks.md — Task breakdown
 */
export async function scaffoldFeature(
	featureDir: string,
): Promise<Result<void>> {
	try {
		if (!existsSync(featureDir)) {
			return {
				ok: false,
				error: `Feature directory does not exist: ${featureDir}`,
			};
		}

		await Bun.write(join(featureDir, "spec.md"), SPEC_TEMPLATE);
		await Bun.write(join(featureDir, "plan.md"), PLAN_TEMPLATE);
		await Bun.write(join(featureDir, "tasks.md"), TASKS_TEMPLATE);

		return { ok: true, value: undefined };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `Failed to scaffold feature: ${message}` };
	}
}

/**
 * Build a spec.md from design choices, filling in concrete details
 * instead of generic [NEEDS CLARIFICATION] markers.
 */
function buildEnrichedSpec(name: string, choices: DesignChoices): string {
	const lines: string[] = [];
	lines.push(`# Feature: ${name}`);
	lines.push("");
	lines.push("> WHAT and WHY only — no implementation details here.");
	lines.push("");

	if (choices.description) {
		lines.push(`## Overview`);
		lines.push("");
		lines.push(choices.description);
		lines.push("");
	}

	lines.push("## User Stories");
	lines.push("");
	lines.push("- As a [role], I want [capability] so that [benefit].");
	lines.push("");

	lines.push("## Acceptance Criteria");
	lines.push("");
	lines.push("- [ ] [NEEDS CLARIFICATION] Define acceptance criteria.");
	lines.push("");

	if (choices.tradeoffs && choices.tradeoffs.length > 0) {
		lines.push("## Design Decisions");
		lines.push("");
		for (const tradeoff of choices.tradeoffs) {
			lines.push(`- ${tradeoff}`);
		}
		lines.push("");
	}

	if (choices.clarifications && choices.clarifications.length > 0) {
		lines.push("## Resolved Questions");
		lines.push("");
		for (const c of choices.clarifications) {
			lines.push(`- **Q:** ${c.question}`);
			lines.push(`  **A:** ${c.answer}`);
		}
		lines.push("");
	}

	lines.push("## [NEEDS CLARIFICATION]");
	lines.push("");
	lines.push("- List any remaining open questions here.");
	lines.push("");
	return lines.join("\n");
}

/**
 * Build a plan.md from design choices, pre-filling architecture
 * and library selections.
 */
function buildEnrichedPlan(choices: DesignChoices): string {
	const lines: string[] = [];
	lines.push("# Implementation Plan");
	lines.push("");
	lines.push("> HOW only — see spec.md for WHAT and WHY.");
	lines.push("");

	lines.push("## Architecture");
	lines.push("");
	if (choices.pattern) {
		lines.push(`- Pattern: **${choices.pattern}**`);
	} else {
		lines.push("- [NEEDS CLARIFICATION] Describe the technical approach.");
	}
	lines.push("");

	if (choices.libraries && choices.libraries.length > 0) {
		lines.push("## Libraries & Tools");
		lines.push("");
		for (const lib of choices.libraries) {
			lines.push(`- ${lib}`);
		}
		lines.push("");
	}

	lines.push("## Tasks");
	lines.push("");
	lines.push("- [ ] [NEEDS CLARIFICATION] Break down implementation tasks.");
	lines.push("");
	return lines.join("\n");
}

/**
 * Scaffold feature files enriched with user's design choices.
 * Falls back to generic templates for any missing choices.
 */
export async function scaffoldFeatureWithContext(
	featureDir: string,
	name: string,
	choices: DesignChoices,
): Promise<Result<void>> {
	try {
		if (!existsSync(featureDir)) {
			return {
				ok: false,
				error: `Feature directory does not exist: ${featureDir}`,
			};
		}

		const spec = buildEnrichedSpec(name, choices);
		const plan = buildEnrichedPlan(choices);

		await Bun.write(join(featureDir, "spec.md"), spec);
		await Bun.write(join(featureDir, "plan.md"), plan);
		await Bun.write(join(featureDir, "tasks.md"), TASKS_TEMPLATE);

		return { ok: true, value: undefined };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `Failed to scaffold feature: ${message}` };
	}
}
