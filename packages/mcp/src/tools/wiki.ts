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
		"Search and synthesize answers from wiki articles using AI. Returns a synthesized answer with source citations.",
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
				const cwd = process.cwd();
				const wikiDir = join(cwd, ".maina", "wiki");

				const { queryWiki } = await import("@maina/core");
				const result = await queryWiki({
					wikiDir,
					question,
					maxArticles: 10,
					repoRoot: cwd,
				});

				if (!result.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({ error: result.error }),
							},
						],
						isError: true,
					};
				}

				const queryResult = result.value;

				// Optionally save the answer to raw/
				if (save && queryResult.sources.length > 0) {
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
						queryResult.answer,
						"",
						"## Sources",
						"",
						...queryResult.sources.map((s: string) => `- ${s}`),
					].join("\n");
					writeFileSync(join(rawDir, fileName), content);
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									answer: queryResult.answer,
									sources: queryResult.sources,
									cached: queryResult.cached,
								},
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
