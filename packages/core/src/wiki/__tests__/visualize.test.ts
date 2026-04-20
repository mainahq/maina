import { describe, expect, it } from "bun:test";
import type { KnowledgeGraph } from "../graph";
import type { WikiArticle } from "../types";
import { renderGraphHtml } from "../visualize";

function makeGraph(
	nodeDefs: { id: string; type: string; label: string; pageRank: number }[],
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
		path: "entity-x.md",
		type: "entity",
		title: "X",
		content: "",
		contentHash: "h",
		sourceHashes: [],
		backlinks: [],
		forwardLinks: [],
		pageRank: 0,
		lastCompiled: "",
		referenceCount: 0,
		ebbinghausScore: 1,
		...overrides,
	};
}

describe("renderGraphHtml", () => {
	it("empty graph returns empty-state HTML", () => {
		const html = renderGraphHtml(makeGraph([]), []);
		expect(html).toContain("No graph yet");
		expect(html).toContain("<!doctype html>");
	});

	it("renders nodes + edges for a populated graph", () => {
		const graph = makeGraph(
			[
				{ id: "a", type: "entity", label: "A", pageRank: 0.5 },
				{ id: "b", type: "entity", label: "B", pageRank: 0.3 },
				{ id: "m", type: "module", label: "Auth", pageRank: 0.9 },
			],
			[
				{ source: "a", target: "b" },
				{ source: "a", target: "m" },
			],
		);
		const html = renderGraphHtml(graph, []);
		expect(html).toContain('<svg viewBox="0 0');
		expect(html).toContain('data-id="a"');
		expect(html).toContain('data-id="b"');
		expect(html).toContain('data-id="m"');
		expect(html).toContain("<line");
		expect(html).toContain("<circle");
		// Legend entries and search
		expect(html).toContain('<input id="q"');
		expect(html).toContain('data-filter="entity"');
		expect(html).toContain('data-filter="module"');
	});

	it("is deterministic for a fixed seed", () => {
		const graph = makeGraph(
			[
				{ id: "a", type: "entity", label: "A", pageRank: 0.1 },
				{ id: "b", type: "entity", label: "B", pageRank: 0.2 },
				{ id: "c", type: "entity", label: "C", pageRank: 0.3 },
			],
			[
				{ source: "a", target: "b" },
				{ source: "b", target: "c" },
			],
		);
		const h1 = renderGraphHtml(graph, [], { seed: 7, iterations: 50 });
		const h2 = renderGraphHtml(graph, [], { seed: 7, iterations: 50 });
		expect(h1).toBe(h2);
	});

	it("links nodes to matching article paths", () => {
		const graph = makeGraph([
			{ id: "entity:Greeter", type: "entity", label: "Greeter", pageRank: 0.5 },
		]);
		const articles = [
			makeArticle({ title: "Greeter", path: "entity-Greeter.md" }),
		];
		const html = renderGraphHtml(graph, articles);
		expect(html).toContain('data-path="entity-Greeter.md"');
	});

	it("escapes HTML in labels and ids", () => {
		const graph = makeGraph([
			{ id: "<script>", type: "entity", label: 'alert&"it"', pageRank: 0.1 },
		]);
		const html = renderGraphHtml(graph, []);
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("alert&amp;&quot;it&quot;");
	});

	it("stays under 300KB on a 500-node graph", () => {
		const nodes = Array.from({ length: 500 }, (_, i) => ({
			id: `n${i}`,
			type: "entity",
			label: `Node ${i}`,
			pageRank: i / 500,
		}));
		const edges = Array.from({ length: 400 }, (_, i) => ({
			source: `n${i}`,
			target: `n${(i + 1) % 500}`,
		}));
		const html = renderGraphHtml(makeGraph(nodes, edges), [], {
			iterations: 40,
		});
		const bytes = new TextEncoder().encode(html).byteLength;
		expect(bytes).toBeLessThan(300 * 1024);
	});
});
