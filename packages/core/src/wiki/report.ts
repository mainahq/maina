/**
 * Wiki graph audit report — #201.
 *
 * Emits `wiki/GRAPH_REPORT.md` on every compile so that reviewers have a
 * one-page health view of the wiki: how many articles, top PageRank, stalest
 * articles, orphan nodes, dangling wikilinks, duplicate-name disambiguations.
 * A machine-readable companion lives at `wiki/.graph-report.json` for CI.
 *
 * Pure over `(articles, graph, options)` — safe to snapshot-test.
 */

import type { KnowledgeGraph } from "./graph";
import type { ArticleType, WikiArticle } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────

export interface GraphReportOptions {
	/** Wall-clock compile duration in ms. Defaults to 0 (useful in tests). */
	durationMs?: number;
	/** Override "generated at" timestamp for deterministic snapshots. */
	generatedAt?: string;
	/** How many community groupings exist. Optional — helps the summary line. */
	communities?: number;
}

export interface GraphReportData {
	/** ISO timestamp the report was generated. */
	generatedAt: string;
	durationMs: number;
	counts: {
		articles: Record<ArticleType, number> & { total: number };
		nodes: number;
		edges: number;
		communities: number;
	};
	topPageRank: {
		id: string;
		label: string;
		path: string | null;
		pageRank: number;
	}[];
	stalestArticles: {
		path: string;
		ebbinghausScore: number;
		lastCompiled: string;
	}[];
	orphans: { id: string; label: string }[];
	danglingLinks: { fromPath: string; target: string }[];
	duplicateDisambiguations: { name: string; articles: string[] }[];
	truncations: { section: string; total: number; shown: number }[];
}

// ─── Constants ──────────────────────────────────────────────────────────

const TOP_PAGERANK_LIMIT = 20;
const STALE_LIMIT = 10;
const ORPHAN_LIMIT = 50;
const DANGLING_LIMIT = 50;
const DUPLICATES_LIMIT = 50;

// ─── Core computations ──────────────────────────────────────────────────

function articleCountsByType(
	articles: WikiArticle[],
): Record<ArticleType, number> & { total: number } {
	const out: Record<ArticleType, number> & { total: number } = {
		module: 0,
		entity: 0,
		feature: 0,
		decision: 0,
		architecture: 0,
		raw: 0,
		total: 0,
	};
	for (const a of articles) {
		out[a.type] = (out[a.type] ?? 0) + 1;
		out.total += 1;
	}
	return out;
}

function topPageRankNodes(
	graph: KnowledgeGraph,
	articles: WikiArticle[],
	limit = TOP_PAGERANK_LIMIT,
): GraphReportData["topPageRank"] {
	const articleByNodeId = new Map<string, string>();
	for (const a of articles) {
		// article-node mapping is via `path` → node id is best-effort; link the
		// article when the node id matches `entity:<name>` convention or an
		// explicit match. We keep it loose so this function stays pure.
		for (const [id, node] of graph.nodes) {
			if (node.label && a.title && node.label === a.title) {
				articleByNodeId.set(id, a.path);
			}
		}
	}
	return [...graph.nodes.values()]
		.sort((a, b) => {
			if (b.pageRank !== a.pageRank) return b.pageRank - a.pageRank;
			return a.id.localeCompare(b.id);
		})
		.slice(0, limit)
		.map((n) => ({
			id: n.id,
			label: n.label,
			path: articleByNodeId.get(n.id) ?? null,
			pageRank: n.pageRank,
		}));
}

function stalestArticles(
	articles: WikiArticle[],
	limit = STALE_LIMIT,
): GraphReportData["stalestArticles"] {
	return [...articles]
		.sort((a, b) => {
			if (a.ebbinghausScore !== b.ebbinghausScore) {
				return a.ebbinghausScore - b.ebbinghausScore;
			}
			return a.path.localeCompare(b.path);
		})
		.slice(0, limit)
		.map((a) => ({
			path: a.path,
			ebbinghausScore: a.ebbinghausScore,
			lastCompiled: a.lastCompiled,
		}));
}

function orphanNodes(
	graph: KnowledgeGraph,
	limit = ORPHAN_LIMIT,
): { orphans: GraphReportData["orphans"]; total: number } {
	const incident = new Map<string, number>();
	for (const id of graph.nodes.keys()) incident.set(id, 0);
	for (const edge of graph.edges) {
		incident.set(edge.source, (incident.get(edge.source) ?? 0) + 1);
		incident.set(edge.target, (incident.get(edge.target) ?? 0) + 1);
	}
	const orphans = [...graph.nodes.values()]
		.filter((n) => (incident.get(n.id) ?? 0) === 0)
		.sort((a, b) => a.id.localeCompare(b.id));
	return {
		orphans: orphans.slice(0, limit).map((n) => ({ id: n.id, label: n.label })),
		total: orphans.length,
	};
}

function danglingLinks(
	articles: WikiArticle[],
	limit = DANGLING_LIMIT,
): { links: GraphReportData["danglingLinks"]; total: number } {
	const valid = new Set(articles.map((a) => a.path));
	const dangling: GraphReportData["danglingLinks"] = [];
	for (const a of articles) {
		for (const link of a.forwardLinks) {
			if (!valid.has(link.target)) {
				dangling.push({ fromPath: a.path, target: link.target });
			}
		}
	}
	dangling.sort((a, b) => {
		if (a.fromPath !== b.fromPath) return a.fromPath.localeCompare(b.fromPath);
		return a.target.localeCompare(b.target);
	});
	return { links: dangling.slice(0, limit), total: dangling.length };
}

/**
 * Entities share a `name` across multiple files (same class name in two
 * packages, say). Wiki module articles already disambiguate by prefixing
 * the top-level directory in parentheses — this report surfaces every such
 * case so a reviewer can spot symbols that warrant a better local rename.
 */
function duplicateDisambiguations(
	articles: WikiArticle[],
	limit = DUPLICATES_LIMIT,
): {
	duplicates: GraphReportData["duplicateDisambiguations"];
	total: number;
} {
	const byName = new Map<string, string[]>();
	for (const a of articles) {
		if (a.type !== "entity") continue;
		const list = byName.get(a.title) ?? [];
		list.push(a.path);
		byName.set(a.title, list);
	}
	const dupes: GraphReportData["duplicateDisambiguations"] = [];
	for (const [name, paths] of byName) {
		if (paths.length > 1) {
			dupes.push({ name, articles: [...paths].sort() });
		}
	}
	dupes.sort((a, b) => a.name.localeCompare(b.name));
	return { duplicates: dupes.slice(0, limit), total: dupes.length };
}

// ─── Public API ─────────────────────────────────────────────────────────

export function collectReportData(
	articles: WikiArticle[],
	graph: KnowledgeGraph,
	options: GraphReportOptions = {},
): GraphReportData {
	const counts = articleCountsByType(articles);
	const topPr = topPageRankNodes(graph, articles);
	const stale = stalestArticles(articles);
	const { orphans, total: orphanTotal } = orphanNodes(graph);
	const { links: dangling, total: danglingTotal } = danglingLinks(articles);
	const { duplicates, total: duplicateTotal } =
		duplicateDisambiguations(articles);
	const truncations: GraphReportData["truncations"] = [];
	if (orphanTotal > ORPHAN_LIMIT) {
		truncations.push({
			section: "orphans",
			total: orphanTotal,
			shown: ORPHAN_LIMIT,
		});
	}
	if (danglingTotal > DANGLING_LIMIT) {
		truncations.push({
			section: "danglingLinks",
			total: danglingTotal,
			shown: DANGLING_LIMIT,
		});
	}
	if (duplicateTotal > DUPLICATES_LIMIT) {
		truncations.push({
			section: "duplicateDisambiguations",
			total: duplicateTotal,
			shown: DUPLICATES_LIMIT,
		});
	}
	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		durationMs: options.durationMs ?? 0,
		counts: {
			articles: counts,
			nodes: graph.nodes.size,
			edges: graph.edges.length,
			communities: options.communities ?? 0,
		},
		topPageRank: topPr,
		stalestArticles: stale,
		orphans,
		danglingLinks: dangling,
		duplicateDisambiguations: duplicates,
		truncations,
	};
}

export function generateGraphReport(
	articles: WikiArticle[],
	graph: KnowledgeGraph,
	options: GraphReportOptions = {},
): string {
	const data = collectReportData(articles, graph, options);
	return renderMarkdown(data);
}

export function generateGraphReportJson(
	articles: WikiArticle[],
	graph: KnowledgeGraph,
	options: GraphReportOptions = {},
): string {
	return JSON.stringify(collectReportData(articles, graph, options), null, 2);
}

// ─── Markdown renderer ──────────────────────────────────────────────────

function renderMarkdown(d: GraphReportData): string {
	const lines: string[] = [];
	lines.push("# Wiki Graph Audit Report");
	lines.push("");
	lines.push(
		`> Generated ${d.generatedAt} · compile duration ${d.durationMs} ms`,
	);
	lines.push("");

	lines.push("## Summary");
	lines.push("");
	lines.push(`- **Articles:** ${d.counts.articles.total} total`);
	lines.push(`  - module: ${d.counts.articles.module}`);
	lines.push(`  - entity: ${d.counts.articles.entity}`);
	lines.push(`  - feature: ${d.counts.articles.feature}`);
	lines.push(`  - decision: ${d.counts.articles.decision}`);
	lines.push(`  - architecture: ${d.counts.articles.architecture}`);
	lines.push(`- **Graph:** ${d.counts.nodes} nodes · ${d.counts.edges} edges`);
	lines.push(`- **Communities:** ${d.counts.communities}`);
	lines.push("");

	lines.push(`## Top ${TOP_PAGERANK_LIMIT} entities by PageRank`);
	lines.push("");
	if (d.topPageRank.length === 0) {
		lines.push("_No nodes in graph._");
	} else {
		lines.push("| Rank | Node | PageRank | Article |");
		lines.push("|------|------|----------|---------|");
		d.topPageRank.forEach((n, i) => {
			const link = n.path ? `[${n.label}](${n.path})` : n.label;
			lines.push(
				`| ${i + 1} | ${link} | ${n.pageRank.toFixed(4)} | ${n.path ?? "—"} |`,
			);
		});
	}
	lines.push("");

	lines.push(`## Top ${STALE_LIMIT} stalest articles`);
	lines.push("");
	if (d.stalestArticles.length === 0) {
		lines.push("_No articles._");
	} else {
		lines.push("| Article | Ebbinghaus score | Last compiled |");
		lines.push("|---------|------------------|---------------|");
		for (const a of d.stalestArticles) {
			lines.push(
				`| [${a.path}](${a.path}) | ${a.ebbinghausScore.toFixed(4)} | ${a.lastCompiled} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Orphan entities");
	lines.push("");
	if (d.orphans.length === 0) {
		lines.push("_None._");
	} else {
		for (const o of d.orphans) {
			lines.push(`- \`${o.id}\` — ${o.label}`);
		}
		const trunc = d.truncations.find((t) => t.section === "orphans");
		if (trunc) lines.push(`- _and ${trunc.total - trunc.shown} more_`);
	}
	lines.push("");

	lines.push("## Dangling wikilinks");
	lines.push("");
	if (d.danglingLinks.length === 0) {
		lines.push("_None._");
	} else {
		for (const l of d.danglingLinks) {
			lines.push(`- [${l.fromPath}](${l.fromPath}) → \`[[${l.target}]]\``);
		}
		const trunc = d.truncations.find((t) => t.section === "danglingLinks");
		if (trunc) lines.push(`- _and ${trunc.total - trunc.shown} more_`);
	}
	lines.push("");

	lines.push("## Duplicate-name entities (disambiguated)");
	lines.push("");
	if (d.duplicateDisambiguations.length === 0) {
		lines.push("_None._");
	} else {
		for (const dup of d.duplicateDisambiguations) {
			lines.push(`- **${dup.name}** in:`);
			for (const p of dup.articles) lines.push(`  - [${p}](${p})`);
		}
		const trunc = d.truncations.find(
			(t) => t.section === "duplicateDisambiguations",
		);
		if (trunc) lines.push(`- _and ${trunc.total - trunc.shown} more_`);
	}
	lines.push("");

	return lines.join("\n");
}
