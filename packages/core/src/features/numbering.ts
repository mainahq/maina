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

// ─── Spec Template (Product Manager perspective) ─────────────────────────────
// Think as a PM: What problem are we solving? For whom? How will we know it works?
// Inspired by Superpowers brainstorming: purpose, constraints, success criteria.

const SPEC_TEMPLATE = `# Feature: [Name]

## Problem Statement

What specific problem does this solve? Who experiences it? What happens if we don't solve it?

- [NEEDS CLARIFICATION] Define the problem clearly.

## Target User

Who benefits? What is their current workflow? What frustrates them about it?

- Primary: [NEEDS CLARIFICATION]
- Secondary: [NEEDS CLARIFICATION]

## User Stories

- As a [role], I want [capability] so that [benefit].

## Success Criteria

How do we know this works? Every criterion must be testable — if you can't write
an assertion for it, the requirement isn't clear enough.

- [ ] [NEEDS CLARIFICATION] Define measurable, testable criteria.

## Scope

### In Scope

- [NEEDS CLARIFICATION] What this feature does.

### Out of Scope

- [NEEDS CLARIFICATION] What this feature explicitly does NOT do (prevents over-building).

## Design Decisions

Key choices made and WHY. Record tradeoffs — future you will thank you.

- [NEEDS CLARIFICATION] What alternatives were considered? Why was this one chosen?

## Open Questions

- [NEEDS CLARIFICATION] List ambiguities. Every question here must be resolved before implementation.
`;

// ─── Plan Template (Technical Architect perspective) ─────────────────────────
// Think as an architect: What's the simplest approach? What are the failure modes?
// How does this fit into the existing system? Where are the integration points?

const PLAN_TEMPLATE = `# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

What is the technical approach? How does it fit into existing architecture?
Where are the integration points with existing code?

- Pattern: [NEEDS CLARIFICATION]
- Integration points: [NEEDS CLARIFICATION]

## Key Technical Decisions

What libraries, patterns, or approaches? WHY these and not alternatives?

- [NEEDS CLARIFICATION]

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| [NEEDS CLARIFICATION] | | |

## Tasks

TDD: every implementation task must have a preceding test task.

- [ ] [NEEDS CLARIFICATION] Break down into small, testable tasks.

## Failure Modes

What can go wrong? How do we handle it gracefully?

- [NEEDS CLARIFICATION]

## Testing Strategy

Unit tests, integration tests, or both? What mocks are needed?

- [NEEDS CLARIFICATION]
`;

// ─── Tasks Template ──────────────────────────────────────────────────────────

const TASKS_TEMPLATE = `# Task Breakdown

## Tasks

Each task should be completable in one commit. Test tasks precede implementation tasks.

- [ ] [NEEDS CLARIFICATION] Define tasks.

## Dependencies

Which tasks block which? Draw the critical path.

- [NEEDS CLARIFICATION]

## Definition of Done

How do we know this feature is complete?

- [ ] All tests pass
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] maina analyze shows no errors
- [ ] [NEEDS CLARIFICATION] Feature-specific criteria
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

	if (choices.description) {
		lines.push("## Problem Statement");
		lines.push("");
		lines.push(choices.description);
		lines.push("");
	}

	lines.push("## User Stories");
	lines.push("");
	lines.push("- As a [role], I want [capability] so that [benefit].");
	lines.push("");

	lines.push("## Success Criteria");
	lines.push("");
	lines.push(
		"- [ ] [NEEDS CLARIFICATION] Define measurable, testable criteria.",
	);
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

	lines.push("## Open Questions");
	lines.push("");
	lines.push("- [NEEDS CLARIFICATION] Resolve before implementation.");
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
		lines.push("## Key Technical Decisions");
		lines.push("");
		for (const lib of choices.libraries) {
			lines.push(`- ${lib}`);
		}
		lines.push("");
	}

	lines.push("## Tasks");
	lines.push("");
	lines.push("TDD: every implementation task must have a preceding test task.");
	lines.push("");
	lines.push(
		"- [ ] [NEEDS CLARIFICATION] Break down into small, testable tasks.",
	);
	lines.push("");

	lines.push("## Failure Modes");
	lines.push("");
	lines.push("- [NEEDS CLARIFICATION] What can go wrong?");
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
