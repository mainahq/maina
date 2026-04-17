/**
 * Pattern Sampler — detect coding style patterns from code samples.
 *
 * Samples <=100 files per language, detects patterns via regex,
 * emits medium-confidence constitution rules.
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import type { ConstitutionRule } from "./git-analyzer";

// ── File Sampling ──────────────────────────────────────────────────────

/**
 * Collect TypeScript files from a directory tree, sorted alphabetically.
 * Caps at `maxFiles`. Skips node_modules, dist, .maina, __tests__.
 */
export function sampleFiles(dir: string, maxFiles = 100): string[] {
	const files: string[] = [];
	const visited = new Set<string>();
	const skipDirs = new Set([
		"node_modules",
		"dist",
		".maina",
		"__tests__",
		"__mocks__",
		".git",
		"coverage",
	]);

	function walk(current: string): void {
		if (files.length >= maxFiles) return;
		// Guard against symlink cycles
		try {
			const realPath = realpathSync(current);
			if (visited.has(realPath)) return;
			visited.add(realPath);
		} catch {
			return;
		}
		try {
			const entries = readdirSync(current).sort();
			for (const entry of entries) {
				if (files.length >= maxFiles) return;
				const full = join(current, entry);
				try {
					const stat = statSync(full);
					if (stat.isDirectory() && !skipDirs.has(entry)) {
						walk(full);
					} else if (
						stat.isFile() &&
						(entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
						!entry.endsWith(".test.ts") &&
						!entry.endsWith(".test.tsx") &&
						!entry.endsWith(".spec.ts") &&
						!entry.endsWith(".spec.tsx") &&
						!entry.endsWith(".d.ts") &&
						!entry.endsWith(".d.tsx")
					) {
						files.push(full);
					}
				} catch {
					// Skip unreadable entries
				}
			}
		} catch {
			// Skip unreadable directories
		}
	}

	walk(dir);
	return files;
}

// ── Pattern Detectors ──────────────────────────────────────────────────

interface PatternCount {
	pattern: string;
	alternative: string;
	patternCount: number;
	alternativeCount: number;
}

function countPatterns(
	contents: string[],
	patternRegex: RegExp,
	alternativeRegex: RegExp,
): PatternCount & { total: number } {
	let patternCount = 0;
	let alternativeCount = 0;

	for (const content of contents) {
		patternCount += (content.match(patternRegex) || []).length;
		alternativeCount += (content.match(alternativeRegex) || []).length;
	}

	return {
		pattern: "",
		alternative: "",
		patternCount,
		alternativeCount,
		total: patternCount + alternativeCount,
	};
}

/**
 * Detect async/await vs .then() usage.
 */
export function detectAsyncStyle(contents: string[]): ConstitutionRule | null {
	const counts = countPatterns(contents, /\bawait\s/g, /\.then\s*\(/g);

	if (counts.total < 5) return null;

	const awaitRate = counts.patternCount / counts.total;
	if (awaitRate > 0.7) {
		return {
			text: `Async style: async/await preferred (${Math.round(awaitRate * 100)}% usage)`,
			confidence: Math.min(0.7, awaitRate * 0.7),
			source: `pattern-sampler (${counts.total} async operations sampled)`,
		};
	}
	if (awaitRate < 0.3) {
		return {
			text: `Async style: .then() chains preferred (${Math.round((1 - awaitRate) * 100)}% usage)`,
			confidence: Math.min(0.7, (1 - awaitRate) * 0.7),
			source: `pattern-sampler (${counts.total} async operations sampled)`,
		};
	}
	return null; // Mixed — no clear preference
}

/**
 * Detect arrow function vs function declaration style.
 */
export function detectFunctionStyle(
	contents: string[],
): ConstitutionRule | null {
	const counts = countPatterns(
		contents,
		/(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/g,
		/\bfunction\s+\w+/g,
	);

	if (counts.total < 10) return null;

	const arrowRate = counts.patternCount / counts.total;
	if (arrowRate > 0.7) {
		return {
			text: `Function style: arrow functions preferred (${Math.round(arrowRate * 100)}% usage)`,
			confidence: Math.min(0.7, arrowRate * 0.7),
			source: `pattern-sampler (${counts.total} functions sampled)`,
		};
	}
	if (arrowRate < 0.3) {
		return {
			text: `Function style: function declarations preferred (${Math.round((1 - arrowRate) * 100)}% usage)`,
			confidence: Math.min(0.7, (1 - arrowRate) * 0.7),
			source: `pattern-sampler (${counts.total} functions sampled)`,
		};
	}
	return null;
}

/**
 * Detect named imports vs default imports.
 */
export function detectImportStyle(contents: string[]): ConstitutionRule | null {
	const counts = countPatterns(
		contents,
		/import\s*\{/g,
		/import\s+\w+\s+from/g,
	);

	if (counts.total < 10) return null;

	const namedRate = counts.patternCount / counts.total;
	if (namedRate > 0.7) {
		return {
			text: `Import style: named imports preferred (${Math.round(namedRate * 100)}% usage)`,
			confidence: Math.min(0.7, namedRate * 0.7),
			source: `pattern-sampler (${counts.total} imports sampled)`,
		};
	}
	if (namedRate < 0.3) {
		return {
			text: `Import style: default imports preferred (${Math.round((1 - namedRate) * 100)}% usage)`,
			confidence: Math.min(0.7, (1 - namedRate) * 0.7),
			source: `pattern-sampler (${counts.total} imports sampled)`,
		};
	}
	return null;
}

/**
 * Detect error handling pattern: try/catch vs .catch().
 */
export function detectErrorHandling(
	contents: string[],
): ConstitutionRule | null {
	const counts = countPatterns(contents, /\btry\s*\{/g, /\.catch\s*\(/g);

	if (counts.total < 5) return null;

	const tryCatchRate = counts.patternCount / counts.total;
	if (tryCatchRate > 0.7) {
		return {
			text: `Error handling: try/catch preferred (${Math.round(tryCatchRate * 100)}% usage)`,
			confidence: Math.min(0.7, tryCatchRate * 0.7),
			source: `pattern-sampler (${counts.total} error handling patterns sampled)`,
		};
	}
	if (tryCatchRate < 0.3) {
		return {
			text: `Error handling: .catch() chains preferred (${Math.round((1 - tryCatchRate) * 100)}% usage)`,
			confidence: Math.min(0.7, (1 - tryCatchRate) * 0.7),
			source: `pattern-sampler (${counts.total} error handling patterns sampled)`,
		};
	}
	return null;
}

// ── Combined Runner ────────────────────────────────────────────────────

/**
 * Sample files and detect all patterns. Returns constitution rules
 * with medium confidence scores (0.4–0.7).
 */
export function samplePatterns(repoRoot: string): ConstitutionRule[] {
	const files = sampleFiles(repoRoot);
	if (files.length === 0) return [];

	const contents = files
		.map((f) => {
			try {
				return readFileSync(f, "utf-8");
			} catch {
				return "";
			}
		})
		.filter(Boolean);

	if (contents.length === 0) return [];

	const rules: ConstitutionRule[] = [];
	const detectors = [
		detectAsyncStyle,
		detectFunctionStyle,
		detectImportStyle,
		detectErrorHandling,
	];

	for (const detect of detectors) {
		const rule = detect(contents);
		if (rule) rules.push(rule);
	}

	return rules;
}
