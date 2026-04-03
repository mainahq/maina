/**
 * ADR Design Review.
 *
 * Reviews an Architecture Decision Record against existing ADRs and
 * the project constitution. Performs deterministic checks for MADR
 * section completeness and [NEEDS CLARIFICATION] markers.
 *
 * Single LLM call per command — deterministic checks run without AI.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Result } from "../db/index";
import { loadConstitution } from "../prompts/loader";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReviewContext {
	targetAdr: { path: string; content: string; title: string };
	existingAdrs: Array<{ path: string; content: string; title: string }>;
	constitution: string | null;
}

export interface ReviewOptions {
	aiAvailable?: boolean;
}

export interface ReviewFinding {
	severity: "error" | "warning" | "info";
	message: string;
	section?: string;
}

export interface ReviewResult {
	adrPath: string;
	findings: ReviewFinding[];
	passed: boolean; // true if no errors
	sectionsPresent: string[];
	sectionsMissing: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const REQUIRED_SECTIONS = ["Status", "Context", "Decision", "Consequences"];

const HLD_SECTIONS = [
	"System Overview",
	"Component Boundaries",
	"Data Flow",
	"External Dependencies",
];

const LLD_SECTIONS = [
	"Interfaces & Types",
	"Function Signatures",
	"DB Schema Changes",
	"Sequence of Operations",
	"Error Handling",
	"Edge Cases",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the title from an ADR's first line.
 * Expects format: `# NNNN. Title`
 */
function extractTitle(content: string): string {
	const firstLine = content.split("\n")[0] ?? "";
	const match = firstLine.match(/^#\s+\d{4}\.\s+(.+)/);
	return match?.[1]?.trim() ?? "";
}

/**
 * Extract numeric prefix from an ADR filename.
 * Returns the number if the name matches NNNN-*.md pattern, or null.
 */
function extractNumber(name: string): number | null {
	const match = name.match(/^(\d{4})-.*\.md$/);
	if (!match?.[1]) return null;
	return Number.parseInt(match[1], 10);
}

/**
 * Check which MADR sections are present in the content.
 */
function detectSections(content: string): {
	present: string[];
	missing: string[];
} {
	const present: string[] = [];
	const missing: string[] = [];

	for (const section of REQUIRED_SECTIONS) {
		// Match ## Section as a heading (case-insensitive)
		const pattern = new RegExp(`^##\\s+${section}\\s*$`, "im");
		if (pattern.test(content)) {
			present.push(section);
		} else {
			missing.push(section);
		}
	}

	return { present, missing };
}

/**
 * Count occurrences of [NEEDS CLARIFICATION] in content.
 */
function countClarificationMarkers(content: string): number {
	const matches = content.match(/\[NEEDS CLARIFICATION\]/g);
	return matches?.length ?? 0;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the review context by reading the target ADR, all existing ADRs,
 * and the constitution.
 */
export async function buildReviewContext(
	adrPath: string,
	adrDir: string,
	mainaDir: string,
): Promise<Result<ReviewContext>> {
	try {
		// Read target ADR
		if (!existsSync(adrPath)) {
			return {
				ok: false,
				error: `Target ADR not found: ${adrPath}`,
			};
		}

		const targetContent = readFileSync(adrPath, "utf-8");
		const targetTitle = extractTitle(targetContent);

		// Read all other ADRs from adrDir
		const existingAdrs: ReviewContext["existingAdrs"] = [];

		if (existsSync(adrDir)) {
			const entries = readdirSync(adrDir);
			const targetBasename = basename(adrPath);

			for (const entry of entries) {
				// Skip target ADR and non-ADR files
				if (entry === targetBasename) continue;
				if (extractNumber(entry) === null) continue;

				const filePath = join(adrDir, entry);
				const content = readFileSync(filePath, "utf-8");
				const title = extractTitle(content);

				existingAdrs.push({ path: filePath, content, title });
			}
		}

		// Read constitution
		const constitutionContent = await loadConstitution(mainaDir);
		const constitution =
			constitutionContent.length > 0 ? constitutionContent : null;

		return {
			ok: true,
			value: {
				targetAdr: {
					path: adrPath,
					content: targetContent,
					title: targetTitle,
				},
				existingAdrs,
				constitution,
			},
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Failed to build review context: ${message}`,
		};
	}
}

/**
 * Find an ADR file in the adr directory by its number (e.g., "0001").
 */
export async function findAdrByNumber(
	adrDir: string,
	number: string,
): Promise<Result<string>> {
	try {
		if (!existsSync(adrDir)) {
			return {
				ok: false,
				error: `ADR directory does not exist: ${adrDir}`,
			};
		}

		const paddedNumber = number.padStart(4, "0");
		const entries = readdirSync(adrDir);

		for (const entry of entries) {
			if (entry.startsWith(`${paddedNumber}-`) && entry.endsWith(".md")) {
				return { ok: true, value: join(adrDir, entry) };
			}
		}

		return {
			ok: false,
			error: `No ADR found with number ${paddedNumber}`,
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Failed to find ADR: ${message}`,
		};
	}
}

/**
 * Review an ADR using deterministic checks.
 *
 * Checks:
 * 1. Required MADR sections present (Status, Context, Decision, Consequences)
 * 2. [NEEDS CLARIFICATION] markers flagged as incomplete
 */
export function reviewDesign(
	context: ReviewContext,
	_options?: ReviewOptions,
): Result<ReviewResult> {
	try {
		const findings: ReviewFinding[] = [];
		const { content } = context.targetAdr;

		// Check required sections
		const { present, missing } = detectSections(content);

		for (const section of missing) {
			findings.push({
				severity: "error",
				message: `Missing required section: "## ${section}"`,
				section,
			});
		}

		// Check for [NEEDS CLARIFICATION] markers
		const clarificationCount = countClarificationMarkers(content);
		if (clarificationCount > 0) {
			findings.push({
				severity: "warning",
				message: `Contains ${clarificationCount} [NEEDS CLARIFICATION] marker${clarificationCount > 1 ? "s" : ""} — ADR is incomplete`,
			});
		}

		// Check HLD sections (warning, not error — these are optional for simple ADRs)
		const hasHldHeader = /^##\s+High-Level Design/im.test(content);
		if (!hasHldHeader) {
			findings.push({
				severity: "warning",
				message:
					"Missing High-Level Design section — consider adding for complex decisions",
				section: "High-Level Design",
			});
		} else {
			for (const sub of HLD_SECTIONS) {
				const escaped = sub.replace(/[&]/g, "\\$&");
				const pattern = new RegExp(`^###\\s+${escaped}\\s*$`, "im");
				if (!pattern.test(content)) {
					findings.push({
						severity: "warning",
						message: `High-Level Design missing subsection: "${sub}"`,
						section: `High-Level Design / ${sub}`,
					});
				}
			}
		}

		// Check LLD sections
		const hasLldHeader = /^##\s+Low-Level Design/im.test(content);
		if (!hasLldHeader) {
			findings.push({
				severity: "warning",
				message:
					"Missing Low-Level Design section — consider adding for complex decisions",
				section: "Low-Level Design",
			});
		} else {
			for (const sub of LLD_SECTIONS) {
				const escaped = sub.replace(/[&]/g, "\\$&");
				const pattern = new RegExp(`^###\\s+${escaped}\\s*$`, "im");
				if (!pattern.test(content)) {
					findings.push({
						severity: "warning",
						message: `Low-Level Design missing subsection: "${sub}"`,
						section: `Low-Level Design / ${sub}`,
					});
				}
			}
		}

		const hasErrors = findings.some((f) => f.severity === "error");

		return {
			ok: true,
			value: {
				adrPath: context.targetAdr.path,
				findings,
				passed: !hasErrors,
				sectionsPresent: present,
				sectionsMissing: missing,
			},
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Review failed: ${message}`,
		};
	}
}
