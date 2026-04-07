/**
 * Wiki Lint Tool — checks wiki articles for staleness, orphans, broken links,
 * coverage gaps, and missing articles.
 *
 * Integrates into the Verify Engine pipeline by converting WikiLintResult
 * into Finding[] for diff-only filtering and unified reporting.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { hashFile, loadState } from "../../wiki/state";
import type { WikiLintFinding, WikiLintResult } from "../../wiki/types";
import type { Finding } from "../diff-filter";

// ─── Types ───────────────────────────────────────────────────────────────

export interface WikiLintOptions {
	wikiDir: string;
	repoRoot: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Recursively collect all .md files under a directory. */
function collectMarkdownFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...collectMarkdownFiles(full));
			} else if (entry.name.endsWith(".md")) {
				results.push(full);
			}
		}
	} catch {
		// Directory read failure — skip gracefully
	}

	return results;
}

/** Extract all wiki links like [[entity:foo]], [[module:bar]] from content. */
function extractWikiLinks(content: string): string[] {
	const pattern = /\[\[(\w+:\w[\w-]*)\]\]/g;
	const links: string[] = [];
	let match: RegExpExecArray | null = null;
	match = pattern.exec(content);
	while (match !== null) {
		links.push(match[1] ?? "");
		match = pattern.exec(content);
	}
	return links.filter(Boolean);
}

/** Get article type from file path (e.g., .maina/wiki/modules/foo.md -> module). */
function getArticleTypeFromPath(filePath: string, wikiDir: string): string {
	const rel = relative(wikiDir, filePath);
	const firstDir = rel.split("/")[0] ?? "";
	// Directories use plural names, article types are singular
	const singularMap: Record<string, string> = {
		modules: "module",
		entities: "entity",
		features: "feature",
		decisions: "decision",
		architecture: "architecture",
		raw: "raw",
	};
	return singularMap[firstDir] ?? firstDir;
}

/** Get article identifier from file path. */
function getArticleId(filePath: string, wikiDir: string): string {
	const rel = relative(wikiDir, filePath);
	// Strip extension and first directory
	const parts = rel.split("/");
	parts.shift(); // Remove type directory
	return parts.join("/").replace(/\.md$/, "");
}

/** Build a set of all known article identifiers (type:id format). */
function buildArticleIndex(
	articlePaths: string[],
	wikiDir: string,
): Set<string> {
	const index = new Set<string>();
	for (const path of articlePaths) {
		const type = getArticleTypeFromPath(path, wikiDir);
		const id = getArticleId(path, wikiDir);
		if (type && id) {
			index.add(`${type}:${id}`);
		}
	}
	return index;
}

// ─── Empty Result ────────────────────────────────────────────────────────

function emptyResult(): WikiLintResult {
	return {
		stale: [],
		orphans: [],
		gaps: [],
		brokenLinks: [],
		contradictions: [],
		specDrift: [],
		decisionViolations: [],
		missingRationale: [],
		coveragePercent: 0,
	};
}

// ─── Check Functions ─────────────────────────────────────────────────────

/** Check 1: Stale articles — sourceHashes don't match current file hashes. */
function checkStale(
	articlePaths: string[],
	wikiDir: string,
	repoRoot: string,
): WikiLintFinding[] {
	const state = loadState(wikiDir);
	if (!state) return [];

	const findings: WikiLintFinding[] = [];

	for (const articlePath of articlePaths) {
		const rel = relative(wikiDir, articlePath);
		const articleHash = state.articleHashes[rel];
		if (!articleHash) continue;

		// Read article to check if content hash matches
		try {
			const currentHash = hashFile(articlePath);
			if (currentHash && currentHash !== articleHash) {
				findings.push({
					check: "stale",
					severity: "warning",
					article: rel,
					message: `Article "${rel}" content has changed since last compilation`,
					source: articlePath,
				});
			}
		} catch {
			// File read error — skip
		}
	}

	// Also check if tracked source files have changed
	for (const [file, hash] of Object.entries(state.fileHashes)) {
		const fullPath = join(repoRoot, file);
		const currentHash = hashFile(fullPath);
		if (currentHash !== null && currentHash !== hash) {
			findings.push({
				check: "stale",
				severity: "warning",
				article: file,
				message: `Source file "${file}" has changed since last wiki compilation`,
				source: fullPath,
			});
		}
	}

	return findings;
}

/** Check 2: Missing articles — wiki dir exists but has very few articles. */
function checkMissing(articlePaths: string[]): WikiLintFinding[] {
	if (articlePaths.length < 5) {
		return [
			{
				check: "gap",
				severity: "info",
				article: "",
				message: `Wiki has only ${articlePaths.length} article(s). Run \`maina wiki init\` to generate articles from your codebase.`,
			},
		];
	}
	return [];
}

/** Check 3: Orphan articles — article references deleted source files. */
function checkOrphans(
	articlePaths: string[],
	repoRoot: string,
): WikiLintFinding[] {
	const findings: WikiLintFinding[] = [];

	for (const articlePath of articlePaths) {
		try {
			const content = readFileSync(articlePath, "utf-8");
			// Look for source file references in frontmatter-style comments
			// Pattern: <!-- source: path/to/file.ts -->
			const sourcePattern = /<!--\s*source:\s*(.+?)\s*-->/g;
			let match: RegExpExecArray | null = null;
			match = sourcePattern.exec(content);
			while (match !== null) {
				const sourcePath = match[1]?.trim() ?? "";
				if (sourcePath && !existsSync(join(repoRoot, sourcePath))) {
					findings.push({
						check: "orphan",
						severity: "warning",
						article: articlePath,
						message: `Article references deleted source file: ${sourcePath}`,
						source: sourcePath,
					});
				}
				match = sourcePattern.exec(content);
			}
		} catch {
			// File read error — skip
		}
	}

	return findings;
}

/** Check 4: Broken links — [[type:id]] points to non-existent article. */
function checkBrokenLinks(
	articlePaths: string[],
	wikiDir: string,
): WikiLintFinding[] {
	const index = buildArticleIndex(articlePaths, wikiDir);
	const findings: WikiLintFinding[] = [];

	for (const articlePath of articlePaths) {
		try {
			const content = readFileSync(articlePath, "utf-8");
			const links = extractWikiLinks(content);
			const rel = relative(wikiDir, articlePath);

			for (const link of links) {
				if (!index.has(link)) {
					findings.push({
						check: "broken_link",
						severity: "error",
						article: rel,
						message: `Broken wiki link [[${link}]] — target article does not exist`,
						source: articlePath,
					});
				}
			}
		} catch {
			// File read error — skip
		}
	}

	return findings;
}

/** Check 5: Coverage gap — percentage of source files with wiki articles. */
function calculateCoverage(
	wikiDir: string,
	_repoRoot: string,
): { coveragePercent: number; finding: WikiLintFinding | null } {
	const state = loadState(wikiDir);
	if (!state) {
		return { coveragePercent: 0, finding: null };
	}

	const trackedFiles = Object.keys(state.fileHashes);
	if (trackedFiles.length === 0) {
		return { coveragePercent: 0, finding: null };
	}

	// Count source files that have corresponding articles
	const articleHashes = Object.keys(state.articleHashes);
	const coveredCount = articleHashes.length;
	const totalCount = trackedFiles.length;
	const coveragePercent =
		totalCount > 0 ? Math.round((coveredCount / totalCount) * 100) : 0;

	const finding: WikiLintFinding | null =
		coveragePercent < 50
			? {
					check: "gap",
					severity: "info",
					article: "",
					message: `Wiki coverage is ${coveragePercent}% (${coveredCount}/${totalCount} source files have articles). Consider running \`maina wiki compile\` to improve coverage.`,
				}
			: null;

	return { coveragePercent, finding };
}

// ─── Main ────────────────────────────────────────────────────────────────

/**
 * Run wiki lint checks on a wiki directory.
 *
 * Auto-skips gracefully if .maina/wiki/ doesn't exist — returns empty result.
 */
export function runWikiLint(options: WikiLintOptions): WikiLintResult {
	const { wikiDir, repoRoot } = options;

	// Auto-skip: wiki directory doesn't exist
	if (!existsSync(wikiDir)) {
		return emptyResult();
	}

	// Collect all article .md files
	const articlePaths = collectMarkdownFiles(wikiDir).filter(
		(p) => !p.endsWith(".state.json") && !p.endsWith(".signals.json"),
	);

	// Run all checks
	const stale = checkStale(articlePaths, wikiDir, repoRoot);
	const gaps = checkMissing(articlePaths);
	const orphans = checkOrphans(articlePaths, repoRoot);
	const brokenLinks = checkBrokenLinks(articlePaths, wikiDir);
	const { coveragePercent, finding: coverageFinding } = calculateCoverage(
		wikiDir,
		repoRoot,
	);

	// Add coverage finding to gaps if present
	const allGaps = [...gaps];
	if (coverageFinding) {
		allGaps.push(coverageFinding);
	}

	return {
		stale,
		orphans,
		gaps: allGaps,
		brokenLinks,
		contradictions: [],
		specDrift: [],
		decisionViolations: [],
		missingRationale: [],
		coveragePercent,
	};
}

// ─── Pipeline Integration ────────────────────────────────────────────────

/**
 * Convert WikiLintResult to Finding[] for verify pipeline integration.
 * Maps each WikiLintFinding into the standard Finding shape used by
 * the diff-only filter and pipeline reporting.
 */
export function wikiLintToFindings(result: WikiLintResult): Finding[] {
	const findings: Finding[] = [];

	const allWikiFindings: WikiLintFinding[] = [
		...result.stale,
		...result.orphans,
		...result.gaps,
		...result.brokenLinks,
		...result.contradictions,
		...result.specDrift,
		...result.decisionViolations,
		...result.missingRationale,
	];

	for (const wf of allWikiFindings) {
		findings.push({
			tool: "wiki-lint",
			file: wf.source ?? wf.article,
			line: 0,
			message: wf.message,
			severity: wf.severity,
			ruleId: `wiki/${wf.check}`,
		});
	}

	return findings;
}
