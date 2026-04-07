import { describe, expect, it } from "bun:test";
import type { KnowledgeGraph } from "../graph";
import { generateLinks } from "../linker";
import type { EdgeType } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeGraph(
	edges: Array<{ source: string; target: string; type: EdgeType }>,
): KnowledgeGraph {
	const nodes = new Map<
		string,
		{
			id: string;
			type: "entity" | "module" | "feature" | "decision" | "workflow";
			label: string;
			pageRank: number;
		}
	>();
	const adjacency = new Map<string, Set<string>>();

	for (const edge of edges) {
		if (!nodes.has(edge.source)) {
			nodes.set(edge.source, {
				id: edge.source,
				type: "entity",
				label: edge.source,
				pageRank: 0,
			});
		}
		if (!nodes.has(edge.target)) {
			nodes.set(edge.target, {
				id: edge.target,
				type: "entity",
				label: edge.target,
				pageRank: 0,
			});
		}

		if (!adjacency.has(edge.source)) {
			adjacency.set(edge.source, new Set());
		}
		if (!adjacency.has(edge.target)) {
			adjacency.set(edge.target, new Set());
		}
		adjacency.get(edge.source)?.add(edge.target);
		adjacency.get(edge.target)?.add(edge.source);
	}

	return {
		nodes,
		edges: edges.map((e) => ({ ...e, weight: 1.0 })),
		adjacency,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Wiki Linker", () => {
	describe("generateLinks", () => {
		it("should create forward links from source to target", () => {
			const graph = makeGraph([
				{ source: "entity:A", target: "entity:B", type: "calls" },
			]);
			const articleMap = new Map<string, string>();
			articleMap.set("entity:A", "wiki/entities/A.md");
			articleMap.set("entity:B", "wiki/entities/B.md");

			const result = generateLinks(graph, articleMap);

			const aLinks = result.forwardLinks.get("wiki/entities/A.md") ?? [];
			expect(aLinks.length).toBe(1);
			expect(aLinks[0]?.target).toBe("wiki/entities/B.md");
			expect(aLinks[0]?.type).toBe("calls");
		});

		it("should create backlinks from target to source", () => {
			const graph = makeGraph([
				{ source: "entity:A", target: "entity:B", type: "calls" },
			]);
			const articleMap = new Map<string, string>();
			articleMap.set("entity:A", "wiki/entities/A.md");
			articleMap.set("entity:B", "wiki/entities/B.md");

			const result = generateLinks(graph, articleMap);

			const bBacklinks = result.backlinks.get("wiki/entities/B.md") ?? [];
			expect(bBacklinks.length).toBe(1);
			expect(bBacklinks[0]?.target).toBe("wiki/entities/A.md");
		});

		it("should skip edges where source or target has no article", () => {
			const graph = makeGraph([
				{ source: "entity:A", target: "entity:B", type: "calls" },
			]);
			const articleMap = new Map<string, string>();
			articleMap.set("entity:A", "wiki/entities/A.md");
			// entity:B has no article mapping

			const result = generateLinks(graph, articleMap);

			const aLinks = result.forwardLinks.get("wiki/entities/A.md") ?? [];
			expect(aLinks.length).toBe(0);
		});

		it("should skip self-referential links (same article)", () => {
			const graph = makeGraph([
				{
					source: "entity:A",
					target: "entity:A",
					type: "specified_by",
				},
			]);
			const articleMap = new Map<string, string>();
			articleMap.set("entity:A", "wiki/entities/A.md");

			const result = generateLinks(graph, articleMap);

			const aLinks = result.forwardLinks.get("wiki/entities/A.md") ?? [];
			expect(aLinks.length).toBe(0);
		});

		it("should deduplicate links with the same target and type", () => {
			const graph = makeGraph([
				{ source: "entity:A", target: "entity:B", type: "calls" },
				{ source: "entity:A", target: "entity:B", type: "calls" },
			]);
			const articleMap = new Map<string, string>();
			articleMap.set("entity:A", "wiki/entities/A.md");
			articleMap.set("entity:B", "wiki/entities/B.md");

			const result = generateLinks(graph, articleMap);

			const aLinks = result.forwardLinks.get("wiki/entities/A.md") ?? [];
			expect(aLinks.length).toBe(1);
		});

		it("should keep links of different types to the same target", () => {
			const graph = makeGraph([
				{ source: "entity:A", target: "entity:B", type: "calls" },
				{ source: "entity:A", target: "entity:B", type: "imports" },
			]);
			const articleMap = new Map<string, string>();
			articleMap.set("entity:A", "wiki/entities/A.md");
			articleMap.set("entity:B", "wiki/entities/B.md");

			const result = generateLinks(graph, articleMap);

			const aLinks = result.forwardLinks.get("wiki/entities/A.md") ?? [];
			expect(aLinks.length).toBe(2);
			const types = aLinks.map((l) => l.type).sort();
			expect(types).toEqual(["calls", "imports"]);
		});

		it("should handle all 11 edge types", () => {
			const allEdgeTypes: EdgeType[] = [
				"calls",
				"imports",
				"inherits",
				"references",
				"member_of",
				"modified_by",
				"specified_by",
				"decided_by",
				"motivated_by",
				"constrains",
				"aligns_with",
			];

			const edges = allEdgeTypes.map((type, i) => ({
				source: `entity:src-${i}`,
				target: `entity:tgt-${i}`,
				type,
			}));

			const graph = makeGraph(edges);
			const articleMap = new Map<string, string>();
			for (let i = 0; i < allEdgeTypes.length; i++) {
				articleMap.set(`entity:src-${i}`, `wiki/entities/src-${i}.md`);
				articleMap.set(`entity:tgt-${i}`, `wiki/entities/tgt-${i}.md`);
			}

			const result = generateLinks(graph, articleMap);

			// Each edge type should produce at least one forward link
			for (let i = 0; i < allEdgeTypes.length; i++) {
				const links =
					result.forwardLinks.get(`wiki/entities/src-${i}.md`) ?? [];
				expect(links.length).toBeGreaterThanOrEqual(1);
				expect(links[0]?.type).toBe(allEdgeTypes[i]);
			}
		});

		it("should return empty maps for a graph with no edges", () => {
			const graph: KnowledgeGraph = {
				nodes: new Map(),
				edges: [],
				adjacency: new Map(),
			};
			const articleMap = new Map<string, string>();

			const result = generateLinks(graph, articleMap);

			expect(result.forwardLinks.size).toBe(0);
			expect(result.backlinks.size).toBe(0);
		});

		it("should handle multiple forward links from one article", () => {
			const graph = makeGraph([
				{ source: "entity:A", target: "entity:B", type: "calls" },
				{ source: "entity:A", target: "entity:C", type: "imports" },
				{
					source: "entity:A",
					target: "entity:D",
					type: "references",
				},
			]);
			const articleMap = new Map<string, string>();
			articleMap.set("entity:A", "wiki/entities/A.md");
			articleMap.set("entity:B", "wiki/entities/B.md");
			articleMap.set("entity:C", "wiki/entities/C.md");
			articleMap.set("entity:D", "wiki/entities/D.md");

			const result = generateLinks(graph, articleMap);

			const aLinks = result.forwardLinks.get("wiki/entities/A.md") ?? [];
			expect(aLinks.length).toBe(3);
		});
	});
});
