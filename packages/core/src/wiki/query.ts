/**
 * Wiki Query — AI-powered question answering over wiki articles.
 *
 * Loads relevant wiki articles, scores them by keyword relevance,
 * then uses AI to synthesize a coherent answer citing sources.
 * Falls back to keyword excerpts when AI is unavailable.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";

// ─── Types ───────────────────────────────────────────────────────────────

export interface WikiQueryResult {
	answer: string;
	sources: string[];
	cached: boolean;
}

export interface WikiQueryOptions {
	wikiDir: string;
	question: string;
	maxArticles?: number;
	repoRoot?: string;
	/** Optional override for AI generation (used in tests). */
	_aiGenerate?: (
		task: string,
		mainaDir: string,
		variables: Record<string, string>,
		userPrompt: string,
	) => Promise<{ text: string | null; fromAI: boolean }>;
}

interface LoadedArticle {
	path: string;
	content: string;
	title: string;
}

interface ScoredArticle extends LoadedArticle {
	score: number;
	excerpt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_MAX_ARTICLES = 10;

const ARTICLE_SUBDIRS = [
	"modules",
	"entities",
	"features",
	"decisions",
	"architecture",
	"raw",
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase words, removing punctuation and short words.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2);
}

/**
 * Extract the first heading from markdown content.
 */
function extractTitle(content: string): string {
	const firstLine = content.split("\n")[0] ?? "";
	return firstLine.replace(/^#+\s*/, "").trim();
}

/**
 * Extract the most relevant excerpt from content given query tokens.
 */
function extractExcerpt(
	content: string,
	queryTokens: string[],
	maxLength = 200,
): string {
	const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

	let bestParagraph = "";
	let bestScore = -1;

	for (const paragraph of paragraphs) {
		if (paragraph.trim().startsWith("#") && !paragraph.includes("\n")) {
			continue;
		}

		const words = tokenize(paragraph);
		const matchCount = queryTokens.filter((qt) =>
			words.some((w) => w.includes(qt)),
		).length;

		if (matchCount > bestScore) {
			bestScore = matchCount;
			bestParagraph = paragraph;
		}
	}

	const cleaned = bestParagraph.replace(/\n/g, " ").trim();
	if (cleaned.length > maxLength) {
		return `${cleaned.slice(0, maxLength)}...`;
	}
	return cleaned;
}

/**
 * Load all markdown articles from wiki subdirectories.
 */
function loadArticles(wikiDir: string): LoadedArticle[] {
	const articles: LoadedArticle[] = [];

	for (const subdir of ARTICLE_SUBDIRS) {
		const dir = join(wikiDir, subdir);
		if (!existsSync(dir)) continue;

		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;
			const fullPath = join(dir, entry);
			try {
				const content = readFileSync(fullPath, "utf-8");
				const title = extractTitle(content);
				articles.push({ path: `${subdir}/${entry}`, content, title });
			} catch {
				// skip unreadable files
			}
		}
	}

	return articles;
}

/**
 * Score articles by keyword relevance to the question.
 */
function scoreArticles(
	articles: LoadedArticle[],
	question: string,
): ScoredArticle[] {
	const queryTokens = tokenize(question);
	if (queryTokens.length === 0) return [];

	const scored: ScoredArticle[] = [];

	for (const article of articles) {
		const contentTokens = tokenize(article.content);
		const titleTokens = tokenize(article.title);

		let matchCount = 0;
		for (const qt of queryTokens) {
			if (contentTokens.some((ct) => ct.includes(qt))) {
				matchCount++;
			}
		}

		// Bonus for title matches
		for (const qt of queryTokens) {
			if (titleTokens.some((tt) => tt.includes(qt))) {
				matchCount += 2;
			}
		}

		if (matchCount > 0) {
			const score = matchCount / queryTokens.length;
			const excerpt = extractExcerpt(article.content, queryTokens);
			scored.push({ ...article, score, excerpt });
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return scored;
}

/**
 * Format article contents for the AI prompt context window.
 */
function formatArticlesForPrompt(articles: ScoredArticle[]): string {
	return articles.map((a) => `## ${a.path}\n${a.content}\n---`).join("\n\n");
}

/**
 * Build a fallback answer from keyword-scored articles (no AI).
 */
function buildFallbackAnswer(
	scored: ScoredArticle[],
	maxArticles: number,
): WikiQueryResult {
	const topResults = scored.slice(0, maxArticles);

	if (topResults.length === 0) {
		return {
			answer: "No relevant articles found.",
			sources: [],
			cached: false,
		};
	}

	const parts: string[] = [];
	parts.push(
		`Found ${scored.length} relevant article(s) (keyword match, AI unavailable):\n`,
	);

	for (let i = 0; i < topResults.length; i++) {
		const result = topResults[i];
		if (!result) continue;
		parts.push(
			`${i + 1}. **${result.title}** (\`${result.path}\`, score: ${result.score.toFixed(2)})`,
		);
		if (result.excerpt) {
			parts.push(`   ${result.excerpt}`);
		}
		parts.push("");
	}

	return {
		answer: parts.join("\n"),
		sources: topResults.map((r) => r.path),
		cached: false,
	};
}

// ─── Main ────────────────────────────────────────────────────────────────

/**
 * Query the wiki with a natural-language question.
 *
 * 1. Loads all wiki articles
 * 2. Scores by keyword relevance
 * 3. Takes top N articles as context
 * 4. Calls AI to synthesize an answer citing sources
 * 5. Falls back to keyword excerpts when AI is unavailable
 */
export async function queryWiki(
	options: WikiQueryOptions,
): Promise<Result<WikiQueryResult>> {
	const { wikiDir, question, maxArticles = DEFAULT_MAX_ARTICLES } = options;

	// Check wiki exists
	if (!existsSync(wikiDir)) {
		return {
			ok: true,
			value: {
				answer: "Wiki not initialized. Run `maina wiki init` first.",
				sources: [],
				cached: false,
			},
		};
	}

	// Load articles
	const articles = loadArticles(wikiDir);
	if (articles.length === 0) {
		return {
			ok: true,
			value: {
				answer: "Wiki is empty. Run `maina wiki compile` to generate articles.",
				sources: [],
				cached: false,
			},
		};
	}

	// Score and rank
	const scored = scoreArticles(articles, question);
	if (scored.length === 0) {
		return {
			ok: true,
			value: {
				answer: `No articles match the query: "${question}"`,
				sources: [],
				cached: false,
			},
		};
	}

	const topArticles = scored.slice(0, maxArticles);
	const sources = topArticles.map((a) => a.path);

	// Try AI synthesis
	try {
		const aiGenerate =
			options._aiGenerate ?? (await import("../ai/try-generate")).tryAIGenerate;
		const mainaDir = options.repoRoot
			? join(options.repoRoot, ".maina")
			: join(wikiDir, "..");

		const articlesContext = formatArticlesForPrompt(topArticles);
		const userPrompt = [
			`Question: ${question}`,
			"",
			"Here are relevant wiki articles:",
			"",
			articlesContext,
		].join("\n");

		const aiResult = await aiGenerate(
			"wiki-query",
			mainaDir,
			{ question },
			userPrompt,
		);

		if (aiResult.text) {
			return {
				ok: true,
				value: {
					answer: aiResult.text,
					sources,
					cached: false,
				},
			};
		}
	} catch {
		// AI unavailable — fall through to fallback
	}

	// Fallback: keyword-based excerpts
	return {
		ok: true,
		value: buildFallbackAnswer(scored, maxArticles),
	};
}
