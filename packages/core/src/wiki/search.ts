/**
 * Wiki Search — Orama-powered full-text search over wiki articles.
 *
 * Provides BM25 scoring, fuzzy matching, and typo tolerance via @orama/orama.
 * Falls back gracefully when Orama is unavailable or the index is missing.
 *
 * Index is persisted to `.search-index.json` for fast startup and rebuilt
 * during `wiki init` and `wiki compile`.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────

export interface WikiSearchResult {
	path: string;
	title: string;
	type: string;
	score: number;
	excerpt: string;
}

export interface WikiSearchIndex {
	search(
		query: string,
		options?: { limit?: number; type?: string },
	): WikiSearchResult[];
	articleCount: number;
}

/** Orama document schema for wiki articles. */
interface WikiDoc {
	id: string;
	path: string;
	title: string;
	type: string;
	content: string;
}

// ─── Constants ───────────────────────────────────────────────────────────

const INDEX_FILENAME = ".search-index.json";

const ARTICLE_SUBDIRS = [
	"modules",
	"entities",
	"features",
	"decisions",
	"architecture",
	"raw",
] as const;

const ORAMA_SCHEMA = {
	path: "string" as const,
	title: "string" as const,
	type: "enum" as const,
	content: "string" as const,
};

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract the first heading from markdown content.
 */
function extractTitle(content: string): string {
	const firstLine = content.split("\n")[0] ?? "";
	return firstLine.replace(/^#+\s*/, "").trim();
}

/**
 * Determine article type from its subdirectory name.
 */
function typeFromSubdir(subdir: string): string {
	// Strip trailing 's' for consistency: "modules" → "module"
	if (subdir.endsWith("s") && subdir !== "raw") {
		return subdir.slice(0, -1);
	}
	return subdir;
}

/**
 * Extract the most relevant excerpt around matching terms.
 */
function extractExcerpt(
	content: string,
	query: string,
	maxLength = 200,
): string {
	const queryWords = query
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 2);

	const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

	let bestParagraph = "";
	let bestScore = -1;

	for (const paragraph of paragraphs) {
		if (paragraph.trim().startsWith("#") && !paragraph.includes("\n")) {
			continue;
		}

		const lower = paragraph.toLowerCase();
		let matchCount = 0;
		for (const word of queryWords) {
			if (lower.includes(word)) {
				matchCount++;
			}
		}

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
 * Walk all .md files in wiki subdirectories and return article metadata.
 */
function walkArticles(
	wikiDir: string,
): Array<{ path: string; title: string; type: string; content: string }> {
	const articles: Array<{
		path: string;
		title: string;
		type: string;
		content: string;
	}> = [];

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
				const type = typeFromSubdir(subdir);
				articles.push({
					path: `${subdir}/${entry}`,
					title,
					type,
					content,
				});
			} catch {
				// skip unreadable files
			}
		}
	}

	return articles;
}

// ─── Core Functions ─────────────────────────────────────────────────────

/**
 * Build a search index from all wiki articles on disk.
 * Called during wiki compile and wiki init.
 */
export async function buildSearchIndex(
	wikiDir: string,
): Promise<WikiSearchIndex> {
	const { create, insert, search: oramaSearch } = await import("@orama/orama");

	const db = create({ schema: ORAMA_SCHEMA });
	const articles = walkArticles(wikiDir);

	for (const article of articles) {
		insert(db, {
			path: article.path,
			title: article.title,
			type: article.type,
			content: article.content,
		});
	}

	return {
		articleCount: articles.length,
		search(
			query: string,
			options?: { limit?: number; type?: string },
		): WikiSearchResult[] {
			const limit = options?.limit ?? 10;
			const searchParams: Record<string, unknown> = {
				term: query,
				properties: ["title", "content"],
				boost: { title: 3 },
				tolerance: 1,
				limit,
			};

			if (options?.type) {
				searchParams.where = { type: { eq: options.type } };
			}

			// Orama search is synchronous in Bun but types include Promise union
			const results = oramaSearch(db, searchParams as never) as {
				hits: Array<{ score: number; document: WikiDoc }>;
			};

			return results.hits.map((hit) => ({
				path: hit.document.path,
				title: hit.document.title,
				type: hit.document.type,
				score: hit.score,
				excerpt: extractExcerpt(hit.document.content, query),
			}));
		},
	};
}

/**
 * Save the search index to disk for fast startup.
 */
export async function saveSearchIndex(
	wikiDir: string,
	index: WikiSearchIndex,
): Promise<void> {
	// We need the underlying Orama DB to save — rebuild it
	// The save format is the Orama RawData JSON-serializable object
	const { create, insert, save } = await import("@orama/orama");

	const db = create({ schema: ORAMA_SCHEMA });
	const articles = walkArticles(wikiDir);

	for (const article of articles) {
		insert(db, {
			path: article.path,
			title: article.title,
			type: article.type,
			content: article.content,
		});
	}

	const raw = save(db);
	const indexPath = join(wikiDir, INDEX_FILENAME);
	writeFileSync(
		indexPath,
		JSON.stringify({ articleCount: index.articleCount, raw }),
	);
}

/**
 * Load a previously saved search index.
 * Returns null if no saved index exists.
 */
export async function loadSearchIndex(
	wikiDir: string,
): Promise<WikiSearchIndex | null> {
	const indexPath = join(wikiDir, INDEX_FILENAME);
	if (!existsSync(indexPath)) return null;

	try {
		const { create, load, search: oramaSearch } = await import("@orama/orama");
		const data = JSON.parse(readFileSync(indexPath, "utf-8")) as {
			articleCount: number;
			raw: unknown;
		};

		const db = create({ schema: ORAMA_SCHEMA });
		load(db, data.raw as never);

		return {
			articleCount: data.articleCount,
			search(
				query: string,
				options?: { limit?: number; type?: string },
			): WikiSearchResult[] {
				const limit = options?.limit ?? 10;
				const searchParams: Record<string, unknown> = {
					term: query,
					properties: ["title", "content"],
					boost: { title: 3 },
					tolerance: 1,
					limit,
				};

				if (options?.type) {
					searchParams.where = { type: { eq: options.type } };
				}

				// Orama search is synchronous in Bun but types include Promise union
				const results = oramaSearch(db, searchParams as never) as {
					hits: Array<{ score: number; document: WikiDoc }>;
				};

				return results.hits.map((hit) => ({
					path: hit.document.path,
					title: hit.document.title,
					type: hit.document.type,
					score: hit.score,
					excerpt: extractExcerpt(hit.document.content, query),
				}));
			},
		};
	} catch {
		return null;
	}
}

/**
 * Universal search function for wiki articles.
 *
 * Tries the persisted Orama index first, then falls back to building
 * a fresh in-memory index. Both query.ts and consult.ts can use this.
 */
export async function searchWiki(
	wikiDir: string,
	query: string,
	options?: { limit?: number; type?: string },
): Promise<WikiSearchResult[]> {
	if (!existsSync(wikiDir)) return [];

	try {
		// Try loading persisted index
		const index = await loadSearchIndex(wikiDir);
		if (index) {
			return index.search(query, options);
		}

		// Fall back to building in-memory
		const freshIndex = await buildSearchIndex(wikiDir);
		return freshIndex.search(query, options);
	} catch {
		// Orama completely unavailable — return empty
		return [];
	}
}
