/**
 * Spec quality scorer.
 *
 * Scores a spec.md file 0-100 based on four dimensions:
 * - Measurability: do criteria use measurable verbs?
 * - Testability: can each criterion be expressed as a test?
 * - Ambiguity: inverse of weasel word count (100 = no ambiguity)
 * - Completeness: are all required sections filled in?
 */

import { existsSync, readFileSync } from "node:fs";
import type { Result } from "../db/index";

/**
 * Extract criteria from both "Acceptance Criteria" and "Success Criteria" sections.
 */
function extractCriteria(content: string): string[] {
	const lines = content.split("\n");
	const criteria: string[] = [];
	let inSection = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (/^##\s+(acceptance\s+criteria|success\s+criteria)/i.test(trimmed)) {
			inSection = true;
			continue;
		}

		if (inSection && /^##\s/.test(trimmed)) {
			break;
		}

		if (inSection && trimmed.startsWith("-")) {
			const text = trimmed.replace(/^-\s*(\[.\]\s*)?/, "").trim();
			if (text.length > 0) {
				criteria.push(text);
			}
		}
	}

	return criteria;
}

export interface QualityScore {
	overall: number;
	measurability: number;
	testability: number;
	ambiguity: number;
	completeness: number;
	details: string[];
}

/**
 * Measurable verbs that indicate concrete, verifiable behaviour.
 */
const MEASURABLE_VERBS = new Set([
	"validates",
	"returns",
	"creates",
	"sends",
	"rejects",
	"throws",
	"writes",
	"reads",
	"parses",
	"computes",
	"generates",
]);

/**
 * Vague verbs that indicate unclear intent.
 */
const VAGUE_VERBS = new Set([
	"handles",
	"manages",
	"supports",
	"processes",
	"deals",
	"takes",
]);

/**
 * Weasel words that indicate ambiguity.
 */
const WEASEL_WORDS = new Set([
	"maybe",
	"might",
	"possibly",
	"should",
	"could",
	"some",
	"various",
	"appropriate",
	"probably",
	"perhaps",
	"fairly",
	"quite",
	"somewhat",
	"arguably",
	"roughly",
]);

/**
 * Required sections in a well-formed spec.
 */
const REQUIRED_SECTIONS = [
	"Problem Statement",
	"User Stories",
	"Success Criteria",
	"Scope",
	"Design Decisions",
];

/**
 * Patterns indicating testable criteria: backtick identifiers, specific
 * numbers, file paths, function names, error messages.
 */
const TESTABLE_PATTERNS = [
	/`[^`]+`/, // backtick-quoted identifiers
	/\b\d+\b/, // specific numbers
	/\/[\w./]+/, // file paths
	/\b[a-z][a-zA-Z]*[A-Z]\w*\b/, // camelCase function names
	/\b(error|Error|ERROR)\s+(code|message|status)\b/i, // error references
];

/**
 * Score measurability of acceptance criteria.
 * Returns 0 when there are no criteria (empty spec).
 */
function scoreMeasurability(criteria: string[]): {
	score: number;
	details: string;
} {
	if (criteria.length === 0) {
		return { score: 0, details: "Measurability: 0 — no acceptance criteria" };
	}

	let measurable = 0;
	let vague = 0;

	for (const criterion of criteria) {
		const lower = criterion.toLowerCase();
		const words = lower.split(/\s+/);

		const hasMeasurable = words.some((w) => MEASURABLE_VERBS.has(w));
		const hasVague = words.some((w) => VAGUE_VERBS.has(w));

		// Also check for two-word vague phrases
		const hasVaguePhrase =
			lower.includes("deals with") || lower.includes("takes care of");

		if (hasMeasurable && !hasVague && !hasVaguePhrase) {
			measurable++;
		} else if (hasVague || hasVaguePhrase) {
			vague++;
		}
	}

	const total = criteria.length;
	const score = Math.round((measurable / total) * 100);

	return {
		score,
		details: `Measurability: ${score} — ${measurable}/${total} criteria use measurable verbs (${vague} vague)`,
	};
}

/**
 * Score testability of acceptance criteria.
 * Criteria with backtick identifiers, specific numbers, file paths, etc.
 */
function scoreTestability(criteria: string[]): {
	score: number;
	details: string;
} {
	if (criteria.length === 0) {
		return { score: 0, details: "Testability: 0 — no acceptance criteria" };
	}

	let testable = 0;

	for (const criterion of criteria) {
		const hasTestablePattern = TESTABLE_PATTERNS.some((p) => p.test(criterion));
		if (hasTestablePattern) {
			testable++;
		}
	}

	const total = criteria.length;
	const score = Math.round((testable / total) * 100);

	return {
		score,
		details: `Testability: ${score} — ${testable}/${total} criteria contain testable patterns`,
	};
}

/**
 * Score ambiguity across entire spec content.
 * 100 = no weasel words, each weasel word deducts 10 points.
 */
function scoreAmbiguity(content: string): { score: number; details: string } {
	if (content.trim().length === 0) {
		return { score: 0, details: "Ambiguity: 0 — empty spec" };
	}

	const words = content.toLowerCase().split(/\s+/);
	let weaselCount = 0;

	for (const word of words) {
		// Strip punctuation for matching
		const clean = word.replace(/[^a-z]/g, "");
		if (WEASEL_WORDS.has(clean)) {
			weaselCount++;
		}
	}

	const score = Math.max(0, 100 - weaselCount * 10);

	return {
		score,
		details: `Ambiguity: ${score} — ${weaselCount} weasel word(s) found`,
	};
}

/**
 * Score completeness based on required sections and [NEEDS CLARIFICATION] markers.
 */
function scoreCompleteness(content: string): {
	score: number;
	details: string;
} {
	if (content.trim().length === 0) {
		return { score: 0, details: "Completeness: 0 — empty spec" };
	}

	let present = 0;
	const missing: string[] = [];

	for (const section of REQUIRED_SECTIONS) {
		// Check for heading containing the section name (case-insensitive)
		const pattern = new RegExp(`^##\\s+${escapeRegex(section)}`, "im");
		if (pattern.test(content)) {
			present++;
		} else {
			missing.push(section);
		}
	}

	let score = Math.round((present / REQUIRED_SECTIONS.length) * 100);

	// Penalize [NEEDS CLARIFICATION] markers
	const clarificationMatches = content.match(/\[NEEDS CLARIFICATION\]/g);
	const markerCount = clarificationMatches?.length ?? 0;
	if (markerCount > 0) {
		score = Math.max(0, score - markerCount * 10);
	}

	const missingStr =
		missing.length > 0 ? ` — missing: ${missing.join(", ")}` : "";
	const markerStr =
		markerCount > 0
			? ` — ${markerCount} [NEEDS CLARIFICATION] marker(s) (-${markerCount * 10})`
			: "";

	return {
		score,
		details: `Completeness: ${score} — ${present}/${REQUIRED_SECTIONS.length} sections present${missingStr}${markerStr}`,
	};
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Score a spec.md file 0-100 based on four dimensions.
 *
 * - Measurability (25%): measurable verbs in acceptance criteria
 * - Testability (25%): testable patterns in acceptance criteria
 * - Ambiguity (25%): inverse of weasel word count
 * - Completeness (25%): required sections + [NEEDS CLARIFICATION] penalty
 */
export function scoreSpec(specPath: string): Result<QualityScore> {
	if (!existsSync(specPath)) {
		return { ok: false, error: `Spec file not found: ${specPath}` };
	}

	let content: string;
	try {
		content = readFileSync(specPath, "utf-8");
	} catch (e) {
		return {
			ok: false,
			error: `Failed to read spec: ${e instanceof Error ? e.message : String(e)}`,
		};
	}

	// Empty spec → all zeros
	if (content.trim().length === 0) {
		return {
			ok: true,
			value: {
				overall: 0,
				measurability: 0,
				testability: 0,
				ambiguity: 0,
				completeness: 0,
				details: ["Empty spec file — all dimensions score 0"],
			},
		};
	}

	const criteria = extractCriteria(content);

	const measurability = scoreMeasurability(criteria);
	const testability = scoreTestability(criteria);
	const ambiguity = scoreAmbiguity(content);
	const completeness = scoreCompleteness(content);

	const overall = Math.round(
		measurability.score * 0.25 +
			testability.score * 0.25 +
			ambiguity.score * 0.25 +
			completeness.score * 0.25,
	);

	return {
		ok: true,
		value: {
			overall,
			measurability: measurability.score,
			testability: testability.score,
			ambiguity: ambiguity.score,
			completeness: completeness.score,
			details: [
				measurability.details,
				testability.details,
				ambiguity.details,
				completeness.details,
				`Overall: ${overall} (weighted average)`,
			],
		},
	};
}
