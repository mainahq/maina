import { describe, expect, it } from "bun:test";
import type { KnowledgeGraph } from "../graph";
import {
	collectReportData,
	generateGraphReport,
	generateGraphReportJson,
} from "../report";
import type { WikiArticle } from "../types";

function makeGraph(
	nodeDefs: {
		id: string;
		type: string;
		label: string;
		pageRank: number;
	}[] = [],
	edgeDefs: { source: string; target: string }[] = [],
): KnowledgeGraph {
	const nodes = new Map();
	for (const n of nodeDefs) {
		nodes.set(n.id, {
			id: n.id,
			type: n.type as never,
			label: n.label,
			pageRank: n.pageRank,
		});
	}
	const edges = edgeDefs.map((e) => ({
		source: e.source,
		target: e.target,
		type: "calls" as never,
		weight: 1,
	}));
	const adjacency = new Map();
	for (const n of nodeDefs) adjacency.set(n.id, new Set());
	for (const e of edges) {
		adjacency.get(e.source)?.add(e.target);
		adjacency.get(e.target)?.add(e.source);
	}
	return { nodes, edges, adjacency };
}

function makeArticle(overrides: Partial<WikiArticle> = {}): WikiArticle {
	return {
		path: "module-auth.md",
		type: "module",
		title: "auth",
		content: "",
		contentHash: "h",
		sourceHashes: [],
		backlinks: [],
		forwardLinks: [],
		pageRank: 0,
		lastCompiled: "2026-04-01T00:00:00Z",
		referenceCount: 0,
		ebbinghausScore: 1.0,
		...overrides,
	};
}

describe("report.collectReportData", () => {
	it("returns empty-state data for an empty input", () => {
		const d = collectReportData([], makeGraph(), {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(d.counts.articles.total).toBe(0);
		expect(d.counts.nodes).toBe(0);
		expect(d.topPageRank).toEqual([]);
		expect(d.orphans).toEqual([]);
	});

	it("counts articles by type", () => {
		const articles = [
			makeArticle({ type: "module", path: "m1.md" }),
			makeArticle({ type: "module", path: "m2.md" }),
			makeArticle({ type: "entity", path: "e1.md" }),
			makeArticle({ type: "feature", path: "f1.md" }),
		];
		const d = collectReportData(articles, makeGraph(), {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(d.counts.articles.total).toBe(4);
		expect(d.counts.articles.module).toBe(2);
		expect(d.counts.articles.entity).toBe(1);
		expect(d.counts.articles.feature).toBe(1);
	});

	it("ranks top entities by PageRank descending", () => {
		const graph = makeGraph([
			{ id: "a", type: "entity", label: "A", pageRank: 0.1 },
			{ id: "b", type: "entity", label: "B", pageRank: 0.9 },
			{ id: "c", type: "entity", label: "C", pageRank: 0.5 },
		]);
		const d = collectReportData([], graph, {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(d.topPageRank.map((n) => n.id)).toEqual(["b", "c", "a"]);
	});

	it("flags orphan nodes (zero incident edges)", () => {
		const graph = makeGraph(
			[
				{ id: "a", type: "entity", label: "A", pageRank: 0 },
				{ id: "b", type: "entity", label: "B", pageRank: 0 },
				{ id: "loner", type: "entity", label: "Loner", pageRank: 0 },
			],
			[{ source: "a", target: "b" }],
		);
		const d = collectReportData([], graph, {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(d.orphans.map((o) => o.id)).toEqual(["loner"]);
	});

	it("flags dangling wikilinks", () => {
		const articles = [
			makeArticle({
				path: "a.md",
				forwardLinks: [
					{ source: "a.md", target: "b.md", type: "wiki" } as never,
					{ source: "a.md", target: "missing.md", type: "wiki" } as never,
				],
			}),
			makeArticle({ path: "b.md" }),
		];
		const d = collectReportData(articles, makeGraph(), {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(d.danglingLinks).toEqual([
			{ fromPath: "a.md", target: "missing.md" },
		]);
	});

	it("flags duplicate-name entities", () => {
		const articles = [
			makeArticle({ type: "entity", path: "pkg-a/Result.md", title: "Result" }),
			makeArticle({ type: "entity", path: "pkg-b/Result.md", title: "Result" }),
			makeArticle({ type: "entity", path: "pkg-c/Unique.md", title: "Unique" }),
		];
		const d = collectReportData(articles, makeGraph(), {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(d.duplicateDisambiguations).toEqual([
			{ name: "Result", articles: ["pkg-a/Result.md", "pkg-b/Result.md"] },
		]);
	});

	it("ranks stalest articles ascending by Ebbinghaus score", () => {
		const articles = [
			makeArticle({ path: "hot.md", ebbinghausScore: 0.9 }),
			makeArticle({ path: "cold.md", ebbinghausScore: 0.1 }),
			makeArticle({ path: "warm.md", ebbinghausScore: 0.5 }),
		];
		const d = collectReportData(articles, makeGraph(), {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(d.stalestArticles.map((s) => s.path)).toEqual([
			"cold.md",
			"warm.md",
			"hot.md",
		]);
	});
});

describe("report.generateGraphReport (markdown)", () => {
	it("is deterministic for fixed input (snapshot)", () => {
		const articles = [
			makeArticle({ type: "module", path: "m1.md", ebbinghausScore: 0.2 }),
			makeArticle({ type: "entity", path: "e1.md", ebbinghausScore: 0.8 }),
		];
		const graph = makeGraph(
			[
				{ id: "x", type: "entity", label: "X", pageRank: 0.5 },
				{ id: "y", type: "entity", label: "Y", pageRank: 0.3 },
				{ id: "orphan", type: "entity", label: "Orphan", pageRank: 0.1 },
			],
			[{ source: "x", target: "y" }],
		);
		const opts = { generatedAt: "2026-04-20T00:00:00Z", durationMs: 123 };

		const r1 = generateGraphReport(articles, graph, opts);
		const r2 = generateGraphReport(articles, graph, opts);
		expect(r1).toBe(r2);
		expect(r1).toContain("# Wiki Graph Audit Report");
		expect(r1).toContain("2026-04-20T00:00:00Z");
		expect(r1).toContain("compile duration 123 ms");
		expect(r1).toContain("Top 20 entities by PageRank");
		expect(r1).toContain("Orphan");
	});

	it("empty-state renders cleanly", () => {
		const md = generateGraphReport([], makeGraph(), {
			generatedAt: "2026-04-20T00:00:00Z",
		});
		expect(md).toContain("Articles:** 0 total");
		expect(md).toContain("_No nodes in graph._");
		expect(md).toContain("## Orphan entities\n\n_None._");
	});
});

describe("report.generateGraphReportJson", () => {
	it("emits valid JSON with the same shape as collectReportData", () => {
		const articles = [makeArticle({ path: "m.md" })];
		const graph = makeGraph([
			{ id: "a", type: "entity", label: "A", pageRank: 0.1 },
		]);
		const opts = { generatedAt: "2026-04-20T00:00:00Z" };
		const json = JSON.parse(generateGraphReportJson(articles, graph, opts));
		const data = collectReportData(articles, graph, opts);
		expect(json).toEqual(data as unknown as Record<string, unknown>);
	});
});
