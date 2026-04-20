import { describe, expect, it } from "bun:test";
import {
	exportCypher,
	exportGraph,
	exportGraphMl,
	exportObsidian,
} from "../export";
import type { KnowledgeGraph } from "../graph";
import type { WikiArticle } from "../types";

function fixture(): KnowledgeGraph {
	const nodes = new Map();
	nodes.set("entity:Greeter", {
		id: "entity:Greeter",
		type: "entity",
		label: "Greeter",
		file: "src/greet.ts",
		pageRank: 0.42,
	});
	nodes.set("entity:VERSION", {
		id: "entity:VERSION",
		type: "entity",
		label: "VERSION",
		file: "src/greet.ts",
		pageRank: 0.08,
	});
	nodes.set("module:core", {
		id: "module:core",
		type: "module",
		label: "core",
		pageRank: 0.9,
	});
	const edges = [
		{
			source: "entity:Greeter",
			target: "entity:VERSION",
			type: "references",
			weight: 1,
		},
		{
			source: "module:core",
			target: "entity:Greeter",
			type: "contains",
			weight: 2,
		},
	];
	const adjacency = new Map();
	for (const [id] of nodes) adjacency.set(id, new Set());
	for (const e of edges) {
		adjacency.get(e.source)?.add(e.target);
		adjacency.get(e.target)?.add(e.source);
	}
	return { nodes, edges: edges as never, adjacency };
}

const NO_ARTICLES: WikiArticle[] = [];

describe("exportCypher", () => {
	it("produces deterministic BEGIN/COMMIT-wrapped output", () => {
		const a = exportCypher(fixture(), NO_ARTICLES);
		const b = exportCypher(fixture(), NO_ARTICLES);
		expect(a).toBe(b);
		expect(a).toStartWith("// Maina knowledge graph — Cypher export\n");
		expect(a).toContain("BEGIN");
		expect(a).toContain("COMMIT");
		expect(a).toContain("CREATE (:Entity {");
		expect(a).toContain("CREATE (:Module {");
		expect(a).toMatch(/CREATE \(a\)-\[:REFERENCES \{weight: 1\}\]->\(b\)/);
		expect(a).toMatch(/CREATE \(a\)-\[:CONTAINS \{weight: 2\}\]->\(b\)/);
	});

	it("escapes single quotes in string values", () => {
		const g = fixture();
		g.nodes.set("quoted", {
			id: "quoted",
			type: "entity",
			label: "O'Brien",
			pageRank: 0.1,
		});
		const out = exportCypher(g, NO_ARTICLES);
		expect(out).toContain("O\\'Brien");
	});
});

describe("exportGraphMl", () => {
	it("emits well-formed XML with typed attributes", () => {
		const xml = exportGraphMl(fixture(), NO_ARTICLES);
		expect(xml).toStartWith('<?xml version="1.0"');
		expect(xml).toContain("<graphml ");
		expect(xml).toContain(`attr.name="label"`);
		expect(xml).toContain(`attr.name="pageRank"`);
		expect(xml).toContain(`<node id="entity:Greeter">`);
		expect(xml).toContain(`<data key="d0">Greeter</data>`);
		expect(xml).toMatch(/<edge id="e\d+" source="entity:Greeter"/);
	});

	it("escapes XML special chars in ids and labels", () => {
		const g = fixture();
		g.nodes.set("weird", {
			id: "<id>",
			type: "entity",
			label: `a&b"c'd<e>`,
			pageRank: 0,
		});
		const xml = exportGraphMl(g, NO_ARTICLES);
		expect(xml).toContain(`<node id="&lt;id&gt;">`);
		expect(xml).toContain(
			`<data key="d0">a&amp;b&quot;c&apos;d&lt;e&gt;</data>`,
		);
	});
});

describe("exportObsidian", () => {
	function findPath(
		files: Record<string, string>,
		prefix: string,
	): string | undefined {
		return Object.keys(files).find((k) => k.startsWith(prefix));
	}

	it("emits a directory map with per-node markdown, an index, and a workspace", () => {
		const files = exportObsidian(fixture(), NO_ARTICLES);
		expect(findPath(files, "entity/entity_Greeter")).toBeString();
		expect(findPath(files, "entity/entity_VERSION")).toBeString();
		expect(findPath(files, "module/module_core")).toBeString();
		expect(files["index.md"]).toContain("# maina graph");
		expect(files["index.md"]).toContain("## entity");
		expect(files["index.md"]).toContain("## module");
		expect(files[".obsidian/workspace.json"]).toBeString();
		expect(
			JSON.parse(files[".obsidian/workspace.json"] ?? "{}"),
		).toHaveProperty("main");
	});

	it("disambiguates filenames when sanitization would collide", () => {
		// Two distinct ids that sanitise to the same base name.
		const nodes = new Map();
		nodes.set("a:b", {
			id: "a:b",
			type: "entity",
			label: "A",
			pageRank: 0.1,
		});
		nodes.set("a_b", {
			id: "a_b",
			type: "entity",
			label: "A2",
			pageRank: 0.2,
		});
		const adjacency = new Map([
			["a:b", new Set()],
			["a_b", new Set()],
		]);
		const graph = {
			nodes,
			edges: [],
			adjacency,
		} as unknown as Parameters<typeof exportObsidian>[0];
		const files = exportObsidian(graph, NO_ARTICLES);
		const matches = Object.keys(files).filter((k) =>
			k.startsWith("entity/a_b"),
		);
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});

	it("includes [[wikilinks]] for outgoing and incoming edges", () => {
		const files = exportObsidian(fixture(), NO_ARTICLES);
		const greeterKey = findPath(files, "entity/entity_Greeter");
		const greeter = (greeterKey && files[greeterKey]) || "";
		expect(greeter).toContain("## Outgoing");
		expect(greeter).toContain("- references → [[entity:VERSION|VERSION]]");
		expect(greeter).toContain("## Incoming");
		expect(greeter).toContain("- contains ← [[module:core|core]]");
	});

	it("frontmatter carries node metadata", () => {
		const files = exportObsidian(fixture(), NO_ARTICLES);
		const greeterKey = findPath(files, "entity/entity_Greeter");
		const greeter = (greeterKey && files[greeterKey]) || "";
		expect(greeter).toStartWith("---\n");
		expect(greeter).toContain('id: "entity:Greeter"');
		expect(greeter).toContain("pageRank: 0.42");
		expect(greeter).toContain('file: "src/greet.ts"');
	});
});

describe("exportGraph dispatcher", () => {
	it("returns string contents for cypher/graphml", () => {
		const c = exportGraph(fixture(), NO_ARTICLES, "cypher");
		const g = exportGraph(fixture(), NO_ARTICLES, "graphml");
		expect(c.ok).toBe(true);
		expect(g.ok).toBe(true);
		if (c.ok && c.format === "cypher") expect(c.contents).toContain("BEGIN");
		if (g.ok && g.format === "graphml")
			expect(g.contents).toContain("<graphml");
	});

	it("returns a directory map for obsidian", () => {
		const o = exportGraph(fixture(), NO_ARTICLES, "obsidian");
		if (o.ok && o.format === "obsidian") {
			expect(Object.keys(o.files).length).toBeGreaterThan(0);
		}
	});

	it("errors on unknown format", () => {
		const r = exportGraph(fixture(), NO_ARTICLES, "gexf" as never);
		expect(r.ok).toBe(false);
	});
});
