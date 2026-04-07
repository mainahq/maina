/**
 * Wiki tools — search wiki articles and check wiki health for MCP clients.
 *
 * Provides two tools:
 * - wikiQuery: Search and synthesize from wiki articles
 * - wikiStatus: Wiki health dashboard
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Types ───────────────────────────────────────────────────────────────

interface ArticleInfo {
	path: string;
	type: string;
	title: string;
	content: string;
}

interface QueryMatch {
	path: string;
	type: string;
	title: string;
	score: number;
	excerpt: string;
}

interface WikiStatusResult {
	initialized: boolean;
	articlesByType: Record<string, number>;
	totalArticles: number;
	coveragePercent: number;
	lastCompile: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const ARTICLE_TYPE_DIRS = [
	"modules",
	"entities",
	"features",
	"decisions",
	"architecture",
	"raw",
] as const;

const DIR_TO_TYPE: Record<string, string> = {
	modules: "module",
	entities: "entity",
	features: "feature",
	decisions: "decision",
	architecture: "architecture",
	raw: "raw",
};

/** Recursively collect .md files under a directory. */
function collectMdFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...collectMdFiles(full));
			} else if (entry.name.endsWith(".md")) {
				results.push(full);
			}
		}
	} catch {
		// Skip directories that can't be read
	}

	return results;
}

/** Load all wiki articles from the wiki directory. */
function loadArticles(wikiDir: string): ArticleInfo[] {
	const articles: ArticleInfo[] = [];

	for (const dir of ARTICLE_TYPE_DIRS) {
		const typeDir = join(wikiDir, dir);
		const files = collectMdFiles(typeDir);
		const type = DIR_TO_TYPE[dir] ?? dir;

		for (const file of files) {
			try {
				const content = readFileSync(file, "utf-8");
				const titleMatch = content.match(/^#\s+(.+)$/m);
				const title = titleMatch?.[1] ?? relative(wikiDir, file);

				articles.push({
					path: relative(wikiDir, file),
					type,
					title,
					content,
				});
			} catch {
				// Skip unreadable files
			}
		}
	}

	return articles;
}

/** Score an article against a search question using keyword matching. */
function scoreArticle(article: ArticleInfo, keywords: string[]): number {
	let score = 0;
	const lowerContent = article.content.toLowerCase();
	const lowerTitle = article.title.toLowerCase();

	for (const keyword of keywords) {
		const lower = keyword.toLowerCase();
		// Title matches are worth more
		if (lowerTitle.includes(lower)) {
			score += 3;
		}
		// Count content occurrences (capped)
		const pattern = new RegExp(
			lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
			"gi",
		);
		const matches = lowerContent.match(pattern);
		if (matches) {
			score += Math.min(matches.length, 5);
		}
	}

	return score;
}

/** Extract a relevant excerpt from content based on keyword proximity. */
function extractExcerpt(
	content: string,
	keywords: string[],
	maxLen = 300,
): string {
	const lower = content.toLowerCase();

	// Find the first keyword occurrence
	let bestPos = -1;
	for (const keyword of keywords) {
		const pos = lower.indexOf(keyword.toLowerCase());
		if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
			bestPos = pos;
		}
	}

	if (bestPos === -1) {
		// No keyword found — return start of content
		return (
			content.slice(0, maxLen).trim() + (content.length > maxLen ? "..." : "")
		);
	}

	// Center excerpt around the keyword
	const start = Math.max(0, bestPos - 50);
	const end = Math.min(content.length, start + maxLen);
	const excerpt = content.slice(start, end).trim();
	const prefix = start > 0 ? "..." : "";
	const suffix = end < content.length ? "..." : "";

	return `${prefix}${excerpt}${suffix}`;
}

/** Load .state.json from wiki directory. */
function loadWikiState(
	wikiDir: string,
): { lastCompile: string; fileCount: number } | null {
	const statePath = join(wikiDir, ".state.json");
	if (!existsSync(statePath)) return null;

	try {
		const raw = readFileSync(statePath, "utf-8");
		const state = JSON.parse(raw) as {
			fileHashes?: Record<string, string>;
			lastFullCompile?: string;
			lastIncrementalCompile?: string;
		};
		const lastCompile =
			state.lastIncrementalCompile || state.lastFullCompile || "";
		const fileCount = Object.keys(state.fileHashes ?? {}).length;
		return { lastCompile, fileCount };
	} catch {
		return null;
	}
}

// ─── Tool Registration ──────────────────────────────────────────────────

export function registerWikiTools(server: McpServer): void {
	// ── wikiQuery ────────────────────────────────────────────────────────
	server.tool(
		"wikiQuery",
		"Search and synthesize answers from wiki articles. Returns top matches with excerpts.",
		{
			question: z
				.string()
				.describe("The question to search for in wiki articles"),
			save: z
				.boolean()
				.optional()
				.describe("If true, saves the answer to wiki/raw/"),
		},
		async ({ question, save }) => {
			try {
				const wikiDir = join(process.cwd(), ".maina", "wiki");

				if (!existsSync(wikiDir)) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									matches: [],
									message: "Wiki not initialized. Run `maina wiki init` first.",
								}),
							},
						],
					};
				}

				const articles = loadArticles(wikiDir);
				if (articles.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									matches: [],
									message:
										"No wiki articles found. Run `maina wiki compile` to generate articles.",
								}),
							},
						],
					};
				}

				// Tokenize question into keywords (filter stopwords)
				const stopwords = new Set([
					"the",
					"a",
					"an",
					"is",
					"are",
					"was",
					"were",
					"in",
					"on",
					"at",
					"to",
					"for",
					"of",
					"with",
					"by",
					"from",
					"and",
					"or",
					"not",
					"it",
					"this",
					"that",
					"what",
					"how",
					"why",
					"when",
					"where",
					"which",
					"do",
					"does",
					"did",
					"has",
					"have",
					"had",
					"be",
					"been",
					"being",
				]);
				const keywords = question
					.toLowerCase()
					.split(/\W+/)
					.filter((w) => w.length > 1 && !stopwords.has(w));

				// Score and rank articles
				const scored: QueryMatch[] = articles
					.map((article) => ({
						path: article.path,
						type: article.type,
						title: article.title,
						score: scoreArticle(article, keywords),
						excerpt: extractExcerpt(article.content, keywords),
					}))
					.filter((m) => m.score > 0)
					.sort((a, b) => b.score - a.score)
					.slice(0, 5);

				// Optionally save the answer to raw/
				if (save && scored.length > 0) {
					const rawDir = join(wikiDir, "raw");
					if (!existsSync(rawDir)) {
						mkdirSync(rawDir, { recursive: true });
					}
					const slug = question
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-|-$/g, "")
						.slice(0, 50);
					const fileName = `query-${slug}.md`;
					const content = [
						`# ${question}`,
						"",
						`> Auto-generated wiki query result`,
						"",
						...scored.map(
							(m) =>
								`## ${m.title}\n\nType: ${m.type} | Score: ${m.score}\n\n${m.excerpt}\n`,
						),
					].join("\n");
					writeFileSync(join(rawDir, fileName), content);
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{ matches: scored, total: articles.length },
								null,
								2,
							),
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ── wikiStatus ──────────────────────────────────────────────────────
	server.tool(
		"wikiStatus",
		"Get wiki health dashboard — article counts by type, coverage, and last compile time.",
		{},
		async () => {
			try {
				const wikiDir = join(process.cwd(), ".maina", "wiki");

				if (!existsSync(wikiDir)) {
					const result: WikiStatusResult = {
						initialized: false,
						articlesByType: {},
						totalArticles: 0,
						coveragePercent: 0,
						lastCompile: "",
					};
					return {
						content: [
							{ type: "text" as const, text: JSON.stringify(result, null, 2) },
						],
					};
				}

				const articles = loadArticles(wikiDir);
				const state = loadWikiState(wikiDir);

				// Count articles by type
				const articlesByType: Record<string, number> = {};
				for (const article of articles) {
					articlesByType[article.type] =
						(articlesByType[article.type] ?? 0) + 1;
				}

				// Calculate coverage
				const fileCount = state?.fileCount ?? 0;
				const coveragePercent =
					fileCount > 0 ? Math.round((articles.length / fileCount) * 100) : 0;

				const result: WikiStatusResult = {
					initialized: true,
					articlesByType,
					totalArticles: articles.length,
					coveragePercent: Math.min(coveragePercent, 100),
					lastCompile: state?.lastCompile ?? "",
				};

				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
