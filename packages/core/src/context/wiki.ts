import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { recordArticlesLoaded } from "../wiki/signals";
import { calculateTokens, type LayerContent } from "./budget";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiContextOptions {
	wikiDir: string;
	workingFiles?: string[]; // from L1 — find their wiki articles
	command?: string; // current command — determines which articles to load
}

interface WikiArticle {
	path: string; // relative path within wiki dir (e.g. "decisions/adr-001.md")
	title: string;
	content: string;
	category: string; // "decision" | "module" | "feature" | "architecture" | "index" | "other"
	score: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Categories of wiki articles mapped to directory names. */
const CATEGORY_DIRS: Record<string, string> = {
	decisions: "decision",
	modules: "module",
	features: "feature",
	architecture: "architecture",
};

/**
 * Commands that trigger specific article categories.
 * Missing commands get the default behavior (index + top articles).
 */
const COMMAND_CATEGORIES: Record<string, string[]> = {
	review: ["decision", "module"],
	verify: ["decision", "module"],
	explain: ["decision", "module", "feature", "architecture"],
	context: ["decision", "module", "feature", "architecture"],
	commit: ["feature", "architecture"],
	plan: ["feature", "architecture"],
	design: ["decision"],
	analyze: ["decision", "module", "feature", "architecture"],
	pr: ["decision", "module", "feature"],
};

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extracts a title from Markdown content.
 * Uses the first `# ` heading, or falls back to the filename.
 */
function extractTitle(content: string, filename: string): string {
	const firstLine = content.split("\n").find((line) => line.startsWith("# "));
	if (firstLine) {
		return firstLine.replace(/^#\s+/, "").trim();
	}
	return basename(filename, ".md");
}

/**
 * Simple Ebbinghaus-style score based on file modification time.
 * More recently modified files get higher scores.
 * Formula: exp(-0.05 * daysSinceModified) clamped to [0.1, 1.0].
 */
function fileRecencyScore(filePath: string): number {
	try {
		const stat = statSync(filePath);
		const daysSinceModified =
			(Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
		const raw = Math.exp(-0.05 * daysSinceModified);
		return Math.min(1, Math.max(0.1, raw));
	} catch {
		return 0.5; // fallback if stat fails
	}
}

/**
 * Determines the category of a wiki article from its directory path.
 */
function categorizeArticle(relPath: string): string {
	const firstDir = relPath.split("/")[0] ?? "";
	return CATEGORY_DIRS[firstDir] ?? "other";
}

/**
 * Recursively collects all .md files from a directory.
 * Excludes index.md (loaded separately).
 */
function collectArticles(dir: string, baseDir: string): string[] {
	const results: string[] = [];

	let entries: string[];
	try {
		entries = readdirSync(dir) as unknown as string[];
	} catch {
		return results;
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		let stat: ReturnType<typeof statSync> | undefined;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}

		if (stat.isDirectory()) {
			results.push(...collectArticles(fullPath, baseDir));
		} else if (stat.isFile() && entry.endsWith(".md")) {
			const rel = relative(baseDir, fullPath);
			// Skip top-level index.md (loaded separately)
			if (rel !== "index.md") {
				results.push(fullPath);
			}
		}
	}

	return results;
}

/**
 * Reads a file safely. Returns empty string on failure.
 */
function tryReadFileSync(filePath: string): string {
	try {
		if (!existsSync(filePath)) return "";
		return readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
}

/**
 * Checks if a wiki article is relevant to the given working files.
 * Matches module articles whose name appears in working file paths.
 */
function isRelevantToWorkingFiles(
	articleRelPath: string,
	workingFiles: string[],
): boolean {
	if (workingFiles.length === 0) return false;

	// Extract the article's base name (e.g., "context-engine" from "modules/context-engine.md")
	const articleName = basename(articleRelPath, ".md").toLowerCase();

	return workingFiles.some((f) => {
		const lower = f.toLowerCase();
		// Check if any working file path contains the article name
		return (
			lower.includes(articleName) ||
			articleName.includes(basename(lower).replace(/\.\w+$/, ""))
		);
	});
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load wiki context from `.maina/wiki/`.
 *
 * 1. Checks if wiki dir exists with articles. Returns null if not initialized.
 * 2. Always loads index.md (overview of what's available).
 * 3. Loads relevant articles based on command context.
 * 4. Scores articles by recency (Ebbinghaus-style) + working file relevance.
 * 5. Returns a formatted LayerContent.
 */
export function loadWikiContext(
	options: WikiContextOptions,
): LayerContent | null {
	const { wikiDir, workingFiles, command } = options;

	// Check if wiki directory exists
	if (!existsSync(wikiDir)) {
		return null;
	}

	// Check if there are any files at all
	let dirEntries: string[];
	try {
		dirEntries = readdirSync(wikiDir) as unknown as string[];
	} catch {
		return null;
	}

	if (dirEntries.length === 0) {
		return null;
	}

	// Load index.md if it exists
	const indexPath = join(wikiDir, "index.md");
	const indexContent = tryReadFileSync(indexPath);

	// Collect all articles
	const articlePaths = collectArticles(wikiDir, wikiDir);

	// No articles and no index — wiki is empty
	if (articlePaths.length === 0 && indexContent.length === 0) {
		return null;
	}

	// Build article objects with scores
	const articles: WikiArticle[] = [];
	for (const fullPath of articlePaths) {
		const relPath = relative(wikiDir, fullPath);
		const content = tryReadFileSync(fullPath);
		if (content.length === 0) continue;

		const category = categorizeArticle(relPath);
		const recency = fileRecencyScore(fullPath);

		// Boost score if article is relevant to working files
		const workingBoost =
			workingFiles !== undefined &&
			isRelevantToWorkingFiles(relPath, workingFiles)
				? 0.3
				: 0;

		const score = Math.min(1, recency + workingBoost);

		articles.push({
			path: relPath,
			title: extractTitle(content, relPath),
			content,
			category,
			score,
		});
	}

	// Filter by command-relevant categories
	const relevantCategories = command ? (COMMAND_CATEGORIES[command] ?? []) : [];

	let filteredArticles: WikiArticle[];
	if (relevantCategories.length > 0) {
		filteredArticles = articles.filter(
			(a) => relevantCategories.includes(a.category) || a.category === "other",
		);
	} else {
		// Default: all articles
		filteredArticles = articles;
	}

	// Sort by score descending
	filteredArticles.sort((a, b) => b.score - a.score);

	// Assemble text
	const text = assembleWikiText(indexContent, filteredArticles);
	const tokens = calculateTokens(text);

	// Record which articles were loaded for RL tracking (non-blocking)
	if (filteredArticles.length > 0) {
		const signalsPath = join(wikiDir, ".signals.json");
		const loadedArticlePaths = filteredArticles.map((a) => a.path);
		recordArticlesLoaded(signalsPath, loadedArticlePaths, command ?? "unknown");
	}

	return {
		name: "wiki",
		text,
		tokens,
		priority: 4,
	};
}

/**
 * Formats wiki content into an LLM-readable text block.
 */
export function assembleWikiText(
	indexContent: string,
	articles: WikiArticle[],
): string {
	const parts: string[] = [];

	parts.push("## Wiki Knowledge (Layer 5)");
	parts.push("");

	if (indexContent.length > 0) {
		parts.push("### Index");
		parts.push(indexContent);
		parts.push("");
	}

	if (articles.length > 0) {
		parts.push("### Relevant Articles");

		for (const article of articles) {
			parts.push(`#### ${article.title} (wiki/${article.path})`);
			parts.push(article.content);
			parts.push("---");
		}
	}

	return parts.join("\n");
}
