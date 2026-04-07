/**
 * `maina wiki query <question>` — keyword-based search across wiki articles.
 *
 * Scores each article by keyword overlap with the question, returns
 * top matches with relevant excerpts. No AI needed — pure text matching.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiQueryResult {
	answer: string;
	sources: string[];
}

export interface WikiQueryOptions {
	save?: boolean;
	json?: boolean;
	cwd?: string;
}

interface ScoredArticle {
	path: string;
	title: string;
	score: number;
	excerpt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase words, removing punctuation.
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
 * Returns the paragraph with the highest keyword density.
 */
function extractExcerpt(
	content: string,
	queryTokens: string[],
	maxLength: number = 200,
): string {
	const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

	let bestParagraph = "";
	let bestScore = -1;

	for (const paragraph of paragraphs) {
		// Skip headings-only paragraphs
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

	// Truncate if too long
	const cleaned = bestParagraph.replace(/\n/g, " ").trim();
	if (cleaned.length > maxLength) {
		return `${cleaned.slice(0, maxLength)}...`;
	}
	return cleaned;
}

/**
 * Load all wiki articles from .maina/wiki/ subdirectories.
 */
function loadArticles(
	wikiDir: string,
): Array<{ path: string; content: string }> {
	const articles: Array<{ path: string; content: string }> = [];
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
		"raw",
	];

	for (const subdir of subdirs) {
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
				articles.push({ path: `${subdir}/${entry}`, content });
			} catch {
				// skip
			}
		}
	}

	return articles;
}

/**
 * Score articles by keyword overlap with the question.
 */
function scoreArticles(
	articles: Array<{ path: string; content: string }>,
	question: string,
): ScoredArticle[] {
	const queryTokens = tokenize(question);
	if (queryTokens.length === 0) return [];

	const scored: ScoredArticle[] = [];

	for (const article of articles) {
		const contentTokens = tokenize(article.content);
		const title = extractTitle(article.content);

		// Count how many query tokens appear in the article
		let matchCount = 0;
		for (const qt of queryTokens) {
			if (contentTokens.some((ct) => ct.includes(qt))) {
				matchCount++;
			}
		}

		// Bonus for title matches
		const titleTokens = tokenize(title);
		for (const qt of queryTokens) {
			if (titleTokens.some((tt) => tt.includes(qt))) {
				matchCount += 2;
			}
		}

		if (matchCount > 0) {
			const score = matchCount / queryTokens.length;
			const excerpt = extractExcerpt(article.content, queryTokens);
			scored.push({ path: article.path, title, score, excerpt });
		}
	}

	// Sort by score descending
	scored.sort((a, b) => b.score - a.score);

	return scored;
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiQueryAction(
	question: string,
	options: WikiQueryOptions = {},
): Promise<WikiQueryResult> {
	const cwd = options.cwd ?? process.cwd();
	const wikiDir = join(cwd, ".maina", "wiki");

	if (!existsSync(wikiDir)) {
		return {
			answer: "Wiki not initialized. Run `maina wiki init` first.",
			sources: [],
		};
	}

	const articles = loadArticles(wikiDir);

	if (articles.length === 0) {
		return {
			answer: "Wiki is empty. Run `maina wiki compile` to generate articles.",
			sources: [],
		};
	}

	const scored = scoreArticles(articles, question);

	if (scored.length === 0) {
		return {
			answer: `No articles match the query: "${question}"`,
			sources: [],
		};
	}

	// Take top 5 results
	const topResults = scored.slice(0, 5);

	// Build answer from top matches
	const answerParts: string[] = [];
	answerParts.push(`Found ${scored.length} relevant article(s):\n`);

	for (let i = 0; i < topResults.length; i++) {
		const result = topResults[i];
		if (!result) continue;
		answerParts.push(
			`${i + 1}. **${result.title}** (\`${result.path}\`, score: ${result.score.toFixed(2)})`,
		);
		if (result.excerpt) {
			answerParts.push(`   ${result.excerpt}`);
		}
		answerParts.push("");
	}

	const answer = answerParts.join("\n");
	const sources = topResults.map((r) => r.path);

	// Optionally save the query result
	if (options.save) {
		const queriesDir = join(wikiDir, "raw");
		if (!existsSync(queriesDir)) {
			const { mkdirSync } = await import("node:fs");
			mkdirSync(queriesDir, { recursive: true });
		}
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const queryFile = join(queriesDir, `query-${timestamp}.md`);
		const queryContent = [
			`# Query: ${question}`,
			"",
			answer,
			"",
			"## Sources",
			"",
			...sources.map((s) => `- ${s}`),
		].join("\n");
		writeFileSync(queryFile, queryContent);
	}

	return { answer, sources };
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiQueryCommand(parent: Command): void {
	parent
		.command("query <question>")
		.description("Search wiki articles by keyword")
		.option("--save", "Save query results to wiki/raw/")
		.option("--json", "Output JSON for CI")
		.action(async (question: string, options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki query");
			}

			const s = spinner();
			if (!jsonMode) {
				s.start("Searching wiki...");
			}

			const result = await wikiQueryAction(question, { json: jsonMode });

			if (!jsonMode) {
				s.stop("Search complete.");
				log.message(result.answer);
				if (result.sources.length > 0) {
					log.info(`Sources: ${result.sources.join(", ")}`);
				}
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
