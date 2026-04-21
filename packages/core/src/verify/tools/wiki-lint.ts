/**
 * Wiki Lint Tool — checks wiki articles for staleness, orphans, broken links,
 * coverage gaps, and missing articles.
 *
 * Integrates into the Verify Engine pipeline by converting WikiLintResult
 * into Finding[] for diff-only filtering and unified reporting.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { extractDecisions } from "../../wiki/extractors/decision";
import { extractFeatures } from "../../wiki/extractors/feature";
import { hashFile, loadState } from "../../wiki/state";
import type { WikiLintFinding, WikiLintResult } from "../../wiki/types";
import type { Finding } from "../diff-filter";

// ─── Types ───────────────────────────────────────────────────────────────

export interface WikiLintOptions {
	wikiDir: string;
	repoRoot: string;
	featuresDir?: string;
	adrDir?: string;
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

// ─── Check 6: Spec Drift Detection ──────────────────────────────────────

/** Directories never to recurse into when scanning for source files. */
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	".git",
	".claude",
	".maina",
	".next",
	".turbo",
	".cache",
]);

/** Recursively collect source files (.ts, .js, .tsx, .jsx) under a directory. */
function collectSourceFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				results.push(...collectSourceFiles(full));
			} else if (/\.(ts|js|tsx|jsx)$/.test(entry.name)) {
				results.push(full);
			}
		}
	} catch {
		// Directory read failure — skip gracefully
	}
	return results;
}

/**
 * True if the file is a test/spec file or under a test/tests/__tests__/__mocks__
 * directory. Test files legitimately throw (e.g. inside it(..., () => { throw }))
 * so production-code rules like "returns Result<>" should skip them.
 */
function isTestFile(filePath: string): boolean {
	return (
		/\.(test|spec)\.[jt]sx?$/.test(filePath) ||
		/[\\/](tests?|__tests__|__mocks__)[\\/]/.test(filePath)
	);
}

/**
 * Check 6: Spec Drift — detect when spec assertions conflict with code.
 *
 * Deterministic: pattern-matches spec assertions for "Result" / "never throw"
 * patterns, then scans feature source files for `throw` statements.
 */
function checkSpecDrift(
	featuresDir: string,
	repoRoot: string,
): WikiLintFinding[] {
	if (!existsSync(featuresDir)) return [];

	const result = extractFeatures(featuresDir);
	if (!result.ok) return [];

	const findings: WikiLintFinding[] = [];
	const resultPattern = /result\s*<|never\s+throw/i;
	const throwPattern = /\bthrow\s+/;

	for (const feature of result.value) {
		// Check if any spec assertion mentions Result pattern or "never throw"
		const hasResultAssertion = feature.specAssertions.some((a) =>
			resultPattern.test(a),
		);

		if (!hasResultAssertion) continue;

		// Scan source files for throw statements
		// If feature has entitiesModified, use those; otherwise scan repo src/
		const filesToScan: string[] = [];

		if (feature.entitiesModified.length > 0) {
			for (const entity of feature.entitiesModified) {
				const fullPath = join(repoRoot, entity);
				if (existsSync(fullPath)) {
					filesToScan.push(fullPath);
				}
			}
		} else {
			// Scan src/ directory under repoRoot for a broad check
			const srcDir = join(repoRoot, "src");
			if (existsSync(srcDir)) {
				filesToScan.push(...collectSourceFiles(srcDir));
			}
		}

		for (const filePath of filesToScan) {
			try {
				const content = readFileSync(filePath, "utf-8");
				const lines = content.split("\n");
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i] ?? "";
					// Skip comments
					const trimmed = line.trim();
					if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
					if (throwPattern.test(line)) {
						const relPath = relative(repoRoot, filePath);
						findings.push({
							check: "spec_drift",
							severity: "warning",
							article: feature.id,
							message: `Spec drift: feature "${feature.id}" asserts Result/never-throw pattern, but "${relPath}" line ${i + 1} uses throw`,
							source: filePath,
						});
						// One finding per file is enough
						break;
					}
				}
			} catch {
				// File read error — skip
			}
		}
	}

	return findings;
}

// ─── Check 7: Decision Violation Detection ──────────────────────────────

/** Known technology constraint patterns extracted from ADR text. */
interface TechConstraint {
	keyword: string;
	violations: { pattern: RegExp; description: string }[];
	/**
	 * When true, skip *.test.* / *.spec.* / __tests__ files.
	 * Applies to rules that describe production-code behaviour (e.g. "return
	 * Result<> instead of throwing") — tests legitimately throw as part of
	 * fixture setup or expected-throw assertions.
	 * Import-form constraints (e.g. "don't import jest") should leave this
	 * off so a rogue jest import in a test file is still caught.
	 */
	skipTests?: boolean;
}

const TECH_CONSTRAINTS: TechConstraint[] = [
	{
		keyword: "bun:test",
		violations: [
			{
				pattern: /from\s+["'](?:jest|vitest|mocha|chai)["']/,
				description: "imports from jest/vitest/mocha/chai",
			},
			{
				pattern: /require\s*\(\s*["'](?:jest|vitest|mocha|chai)["']\s*\)/,
				description: "requires jest/vitest/mocha/chai",
			},
		],
	},
	{
		// Import/require of eslint/prettier only — see #209 and PR #212 review.
		// The `^[^"'\n]*` prefix rejects matches whose line already contains a
		// quote (meaning we're inside a string literal — i.e. a test fixture).
		// Real imports/requires still match because the line prefix before the
		// keyword has no quote.
		keyword: "biome",
		violations: [
			{
				pattern: /^[^"'\n]*\bimport\b[^\n]*["']eslint(?:["']|\/)/m,
				description: "imports from eslint",
			},
			{
				pattern: /^[^"'\n]*\brequire\s*\(\s*["']eslint(?:["']|\/)/m,
				description: "requires eslint",
			},
			{
				pattern: /^[^"'\n]*\bimport\b[^\n]*["']prettier(?:["']|\/)/m,
				description: "imports from prettier",
			},
			{
				pattern: /^[^"'\n]*\brequire\s*\(\s*["']prettier(?:["']|\/)/m,
				description: "requires prettier",
			},
		],
	},
	{
		keyword: "jwt",
		violations: [
			{
				pattern: /from\s+["']express-session["']/,
				description: "imports express-session instead of JWT",
			},
		],
	},
	{
		keyword: "result<",
		skipTests: true,
		violations: [
			{
				pattern: /\bthrow\s+new\b/,
				description: "throws instead of returning Result",
			},
		],
	},
	{
		keyword: "never throw",
		skipTests: true,
		violations: [
			{
				pattern: /\bthrow\s+/,
				description: "uses throw despite never-throw policy",
			},
		],
	},
];

/**
 * Check 7: Decision Violations — detect code that contradicts ADR decisions.
 *
 * Deterministic: extracts technology keywords from accepted ADRs,
 * then scans source files for contradicting imports/configs.
 */
function checkDecisionViolations(
	adrDir: string,
	repoRoot: string,
): WikiLintFinding[] {
	if (!existsSync(adrDir)) return [];

	const result = extractDecisions(adrDir);
	if (!result.ok) return [];

	const findings: WikiLintFinding[] = [];

	// Collect accepted decisions and their applicable constraints
	const activeConstraints: {
		decisionId: string;
		constraint: TechConstraint;
	}[] = [];

	for (const decision of result.value) {
		if (decision.status !== "accepted") continue;

		const fullText =
			`${decision.decision} ${decision.context} ${decision.rationale}`.toLowerCase();

		for (const constraint of TECH_CONSTRAINTS) {
			if (fullText.includes(constraint.keyword)) {
				activeConstraints.push({
					decisionId: decision.id,
					constraint,
				});
			}
		}
	}

	if (activeConstraints.length === 0) return [];

	// Collect source files to scan
	const sourceFiles = collectSourceFiles(repoRoot);

	// Also check for config files at repo root for Biome/ESLint checks
	const configFiles: string[] = [];
	try {
		const rootEntries = readdirSync(repoRoot);
		for (const entry of rootEntries) {
			if (
				entry.startsWith(".eslintrc") ||
				entry.startsWith("eslint.config") ||
				entry.startsWith(".prettierrc") ||
				entry.startsWith("prettier.config")
			) {
				configFiles.push(join(repoRoot, entry));
			}
		}
	} catch {
		// Root dir read failure — skip
	}

	// Check config file names against constraints. This catches the presence of
	// a real .eslintrc / eslint.config file at the repo root — a structural
	// signal that ESLint is in use, independent of any source-file content.
	const configFilenameRules: Record<
		string,
		{ pattern: RegExp; description: string }[]
	> = {
		biome: [
			{
				pattern: /^\.eslintrc|^eslint\.config/,
				description:
					"has .eslintrc / eslint.config at repo root (uses ESLint configuration)",
			},
			{
				pattern: /^\.prettierrc|^prettier\.config/,
				description:
					"has .prettierrc / prettier.config at repo root (uses Prettier configuration)",
			},
		],
	};
	for (const configFile of configFiles) {
		const fileName = relative(repoRoot, configFile);
		for (const { decisionId, constraint } of activeConstraints) {
			const rules = configFilenameRules[constraint.keyword];
			if (!rules) continue;
			for (const rule of rules) {
				if (rule.pattern.test(fileName)) {
					findings.push({
						check: "decision_violation",
						severity: "error",
						article: decisionId,
						message: `Decision violation: ADR "${decisionId}" requires ${constraint.keyword}, but "${fileName}" ${rule.description}`,
						source: configFile,
					});
				}
			}
		}
	}

	// Check source file contents
	for (const filePath of sourceFiles) {
		try {
			const content = readFileSync(filePath, "utf-8");
			const relPath = relative(repoRoot, filePath);
			const fileIsTest = isTestFile(filePath);

			for (const { decisionId, constraint } of activeConstraints) {
				if (constraint.skipTests && fileIsTest) continue;
				for (const violation of constraint.violations) {
					if (violation.pattern.test(content)) {
						findings.push({
							check: "decision_violation",
							severity: "error",
							article: decisionId,
							message: `Decision violation: ADR "${decisionId}" requires ${constraint.keyword}, but "${relPath}" ${violation.description}`,
							source: filePath,
						});
						// One finding per file per constraint is enough
						break;
					}
				}
			}
		} catch {
			// File read error — skip
		}
	}

	return findings;
}

// ─── Check 8: Missing Rationale ─────────────────────────────────────────

/**
 * Count commits for a file using git log.
 * Uses Bun.spawnSync for synchronous operation.
 * Returns 0 if git is unavailable or fails.
 */
function countFileCommits(filePath: string, repoRoot: string): number {
	try {
		const proc = Bun.spawnSync(
			["git", "log", "--oneline", "--follow", "--", filePath],
			{ cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
		);
		if (proc.exitCode !== 0) return 0;
		const output = new TextDecoder().decode(proc.stdout);
		return output.split("\n").filter((line) => line.trim().length > 0).length;
	} catch {
		return 0;
	}
}

/**
 * Check 8: Missing Rationale — flag high-activity files without an ADR.
 *
 * Deterministic: counts commits per tracked source file via git log,
 * then checks if any decision mentions that file path.
 */
function checkMissingRationale(
	wikiDir: string,
	adrDir: string,
	repoRoot: string,
): WikiLintFinding[] {
	const findings: WikiLintFinding[] = [];

	// Load wiki state to get tracked files
	const state = loadState(wikiDir);
	if (!state) return [];

	const trackedFiles = Object.keys(state.fileHashes);
	if (trackedFiles.length === 0) return [];

	// Load decisions and collect all mentioned entity paths
	const mentionedPaths = new Set<string>();
	if (existsSync(adrDir)) {
		const decisionResult = extractDecisions(adrDir);
		if (decisionResult.ok) {
			for (const decision of decisionResult.value) {
				for (const mention of decision.entityMentions) {
					mentionedPaths.add(mention);
				}
			}
		}
	}

	const COMMIT_THRESHOLD = 5;

	for (const file of trackedFiles) {
		// Check if any decision mentions this file path
		const hasMention =
			mentionedPaths.has(file) ||
			[...mentionedPaths].some((m) => file.includes(m) || m.includes(file));

		if (hasMention) continue;

		const commitCount = countFileCommits(file, repoRoot);
		if (commitCount >= COMMIT_THRESHOLD) {
			findings.push({
				check: "missing_rationale",
				severity: "info",
				article: file,
				message: `Missing rationale: "${file}" changed in ${commitCount} commits, no architecture decision recorded`,
				source: join(repoRoot, file),
			});
		}
	}

	return findings;
}

// ─── Check 9: Contradiction Detection ───────────────────────────────────

/**
 * Check 9: Contradictions — detect wiki articles that contradict code.
 *
 * Deterministic:
 * - Entity articles: check if the entity still exists at file:line
 * - Module articles: check if listed entities still exist
 * - Feature articles: check if task status matches tasks.md
 */
function checkContradictions(
	wikiDir: string,
	repoRoot: string,
	featuresDir: string,
): WikiLintFinding[] {
	const findings: WikiLintFinding[] = [];
	const articlePaths = collectMarkdownFiles(wikiDir);

	for (const articlePath of articlePaths) {
		const type = getArticleTypeFromPath(articlePath, wikiDir);

		try {
			const content = readFileSync(articlePath, "utf-8");
			const rel = relative(wikiDir, articlePath);

			if (type === "entity") {
				// Check entity location references: "<!-- source: path/to/file.ts:42 -->"
				const sourceLinePattern = /<!--\s*source:\s*([^:]+):(\d+)\s*-->/g;
				let match: RegExpExecArray | null = null;
				match = sourceLinePattern.exec(content);
				while (match !== null) {
					const sourcePath = match[1]?.trim() ?? "";
					const lineNum = Number.parseInt(match[2] ?? "0", 10);
					const fullPath = join(repoRoot, sourcePath);

					if (!existsSync(fullPath)) {
						findings.push({
							check: "contradiction",
							severity: "warning",
							article: rel,
							message: `Contradiction: entity article references "${sourcePath}" which no longer exists`,
							source: articlePath,
						});
					} else if (lineNum > 0) {
						// Check if the file has enough lines
						try {
							const sourceContent = readFileSync(fullPath, "utf-8");
							const totalLines = sourceContent.split("\n").length;
							if (lineNum > totalLines) {
								findings.push({
									check: "contradiction",
									severity: "warning",
									article: rel,
									message: `Contradiction: entity article references "${sourcePath}:${lineNum}" but file only has ${totalLines} lines`,
									source: articlePath,
								});
							}
						} catch {
							// File read error — skip
						}
					}
					match = sourceLinePattern.exec(content);
				}
			}

			if (type === "module") {
				// Check entity list references: "- [[entity:foo]]" or "<!-- entity: path -->"
				const entityRefPattern = /<!--\s*entity:\s*(.+?)\s*-->/g;
				let match: RegExpExecArray | null = null;
				match = entityRefPattern.exec(content);
				while (match !== null) {
					const entityPath = match[1]?.trim() ?? "";
					if (entityPath && !existsSync(join(repoRoot, entityPath))) {
						findings.push({
							check: "contradiction",
							severity: "warning",
							article: rel,
							message: `Contradiction: module article lists entity "${entityPath}" which no longer exists`,
							source: articlePath,
						});
					}
					match = entityRefPattern.exec(content);
				}
			}

			if (type === "feature") {
				// Check if feature tasks.md has different completion status
				checkFeatureTaskContradiction(
					content,
					rel,
					articlePath,
					featuresDir,
					findings,
				);
			}
		} catch {
			// File read error — skip
		}
	}

	return findings;
}

/**
 * Compare task completion status in wiki feature article vs tasks.md.
 */
function checkFeatureTaskContradiction(
	articleContent: string,
	articleRel: string,
	articlePath: string,
	featuresDir: string,
	findings: WikiLintFinding[],
): void {
	// Extract feature ID from article — look for "<!-- feature: 001-foo -->"
	const featureIdMatch = articleContent.match(/<!--\s*feature:\s*(\S+)\s*-->/);
	if (!featureIdMatch?.[1]) return;

	const featureId = featureIdMatch[1];
	const featureDir = join(featuresDir, featureId);
	if (!existsSync(featureDir)) return;

	const featureResult = extractFeatures(featuresDir);
	if (!featureResult.ok) return;

	const feature = featureResult.value.find((f) => f.id === featureId);
	if (!feature) return;

	// Extract task completion from article content
	const articleTasks = new Map<string, boolean>();
	const taskPattern = /(?:- \[([ xX])\]\s+(T\d+))/g;
	let match: RegExpExecArray | null = null;
	match = taskPattern.exec(articleContent);
	while (match !== null) {
		const completed = match[1] !== " ";
		const taskId = match[2] ?? "";
		if (taskId) {
			articleTasks.set(taskId, completed);
		}
		match = taskPattern.exec(articleContent);
	}

	// Compare with actual tasks
	for (const task of feature.tasks) {
		const articleCompleted = articleTasks.get(task.id);
		if (articleCompleted !== undefined && articleCompleted !== task.completed) {
			findings.push({
				check: "contradiction",
				severity: "warning",
				article: articleRel,
				message: `Contradiction: wiki says task ${task.id} is ${articleCompleted ? "completed" : "incomplete"} but tasks.md says ${task.completed ? "completed" : "incomplete"}`,
				source: articlePath,
			});
		}
	}
}

// ─── Main ────────────────────────────────────────────────────────────────

/**
 * Run wiki lint checks on a wiki directory.
 *
 * Auto-skips gracefully if .maina/wiki/ doesn't exist — returns empty result.
 */
export function runWikiLint(options: WikiLintOptions): WikiLintResult {
	const { wikiDir, repoRoot } = options;
	const featuresDir =
		options.featuresDir ?? join(repoRoot, ".maina", "features");
	const adrDir = options.adrDir ?? join(repoRoot, "adr");

	// Auto-skip: wiki directory doesn't exist
	if (!existsSync(wikiDir)) {
		return emptyResult();
	}

	// Collect all article .md files
	const articlePaths = collectMarkdownFiles(wikiDir).filter(
		(p) => !p.endsWith(".state.json") && !p.endsWith(".signals.json"),
	);

	// Run original checks (1-5)
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

	// Run advanced checks (6-9)
	const specDrift = checkSpecDrift(featuresDir, repoRoot);
	const decisionViolations = checkDecisionViolations(adrDir, repoRoot);
	const missingRationale = checkMissingRationale(wikiDir, adrDir, repoRoot);
	const contradictions = checkContradictions(wikiDir, repoRoot, featuresDir);

	return {
		stale,
		orphans,
		gaps: allGaps,
		brokenLinks,
		contradictions,
		specDrift,
		decisionViolations,
		missingRationale,
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
