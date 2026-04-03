/**
 * AI Review — semantic code review using LLM.
 *
 * Two tiers:
 * - mechanical (always-on): diff + referenced functions, <3s, warnings only
 * - standard (--deep): adds spec/plan context, can emit errors
 */

import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ReferencedFunction {
	name: string;
	filePath: string;
	body: string;
}

export interface EntityWithBody {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	filePath: string;
	body: string;
}

export interface AIReviewOptions {
	diff: string;
	entities: EntityWithBody[];
	deep?: boolean;
	specContext?: string;
	planContext?: string;
	mainaDir: string;
}

export interface AIReviewResult {
	findings: Finding[];
	skipped: boolean;
	tier: "mechanical" | "standard";
	duration: number;
}

const MAX_REFS_PER_FILE = 3;

// ─── Referenced Function Resolution ───────────────────────────────────────

/**
 * Extract function/method names called in added lines of a diff,
 * then match them against known entities to get their bodies.
 * Capped at MAX_REFS_PER_FILE (3) to bound token usage.
 */
export function resolveReferencedFunctions(
	diff: string,
	entities: EntityWithBody[],
): ReferencedFunction[] {
	// Extract added lines from diff
	const addedLines = diff
		.split("\n")
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.join("\n");

	if (!addedLines.trim()) return [];

	// Extract identifier-like tokens that could be function calls
	// Match word( pattern — likely a function call
	const callPattern = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
	const calledNames = new Set<string>();
	for (const match of addedLines.matchAll(callPattern)) {
		if (match[1]) calledNames.add(match[1]);
	}

	// Remove common keywords that match the pattern
	const KEYWORDS = new Set([
		"if",
		"for",
		"while",
		"switch",
		"catch",
		"function",
		"return",
		"new",
		"typeof",
		"instanceof",
		"await",
		"async",
		"import",
		"export",
		"const",
		"let",
		"var",
		"class",
		"throw",
	]);
	for (const kw of KEYWORDS) calledNames.delete(kw);

	if (calledNames.size === 0) return [];

	// Match against known entities
	const matched: ReferencedFunction[] = [];
	for (const entity of entities) {
		if (matched.length >= MAX_REFS_PER_FILE) break;
		if (calledNames.has(entity.name)) {
			matched.push({
				name: entity.name,
				filePath: entity.filePath,
				body: entity.body,
			});
		}
	}

	return matched;
}
