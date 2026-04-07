/**
 * Wiki Indexer — generates the index.md table of contents for the wiki.
 *
 * Groups articles by type, sorts by PageRank within each group,
 * and includes freshness indicators based on last compilation time.
 */

import type { ArticleType, WikiArticle } from "./types";

// ─── Freshness Indicators ───────────────────────────────────────────────

/**
 * Compute a freshness indicator based on how recently the article was compiled.
 * Returns a symbol: fresh (< 1 day), recent (< 7 days), aging (< 30 days), stale (> 30 days).
 */
function freshnessIndicator(lastCompiled: string): string {
	if (!lastCompiled) return "[stale]";

	const compiled = new Date(lastCompiled).getTime();
	const now = Date.now();
	const daysAgo = (now - compiled) / (1000 * 60 * 60 * 24);

	if (daysAgo < 1) return "[fresh]";
	if (daysAgo < 7) return "[recent]";
	if (daysAgo < 30) return "[aging]";
	return "[stale]";
}

// ─── Type Labels ────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ArticleType, string> = {
	architecture: "Architecture",
	module: "Modules",
	entity: "Entities",
	feature: "Features",
	decision: "Decisions",
	raw: "Other",
};

const TYPE_ORDER: ArticleType[] = [
	"architecture",
	"module",
	"entity",
	"feature",
	"decision",
	"raw",
];

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Generate the wiki index.md content.
 * Groups articles by type, sorts by PageRank (descending) within each group,
 * and includes freshness indicators.
 */
export function generateIndex(articles: WikiArticle[]): string {
	const lines: string[] = [];

	lines.push("# Wiki Index");
	lines.push("");
	lines.push(
		`> Auto-generated index. ${articles.length} articles across ${countTypes(articles)} categories.`,
	);
	lines.push("");

	// Group articles by type
	const grouped = new Map<ArticleType, WikiArticle[]>();
	for (const article of articles) {
		const list = grouped.get(article.type) ?? [];
		list.push(article);
		grouped.set(article.type, list);
	}

	// Render each type section in defined order
	for (const type of TYPE_ORDER) {
		const group = grouped.get(type);
		if (!group || group.length === 0) continue;

		// Sort by PageRank descending
		const sorted = [...group].sort((a, b) => b.pageRank - a.pageRank);

		const label = TYPE_LABELS[type];
		lines.push(`## ${label}`);
		lines.push("");

		for (const article of sorted) {
			const freshness = freshnessIndicator(article.lastCompiled);
			lines.push(`- [${article.title}](${article.path}) ${freshness}`);
		}

		lines.push("");
	}

	return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function countTypes(articles: WikiArticle[]): number {
	const types = new Set<ArticleType>();
	for (const article of articles) {
		types.add(article.type);
	}
	return types.size;
}
