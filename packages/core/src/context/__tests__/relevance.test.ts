import { beforeAll, describe, expect, test } from "bun:test";
import {
	createRepo,
	ROOT,
	snapshot,
	unwrap,
} from "../../graph/store/__tests__/helpers";
import { indexRepo } from "../../graph/store/index";
import type { GraphSnapshot } from "../../graph/store/types";
import {
	buildGraph,
	type DependencyGraph,
	pageRank,
	scoreRelevance,
	type TaskContext,
} from "../relevance";

// FR-GRAPH-5: the PageRank input is the code graph's file-level projection,
// not a regex scan of import lines. fileA imports and calls fileB and fileC,
// fileB calls fileC, typeUser only uses a type from typeDef, and external
// imports a package the store cannot resolve.
const FILES: Readonly<Record<string, string>> = {
	"src/fileA.ts":
		'import { foo } from "./fileB";\nimport { bar } from "./fileC";\n\nexport function doA(): void {\n\tfoo();\n\tbar();\n}\n',
	"src/fileB.ts":
		'import { bar } from "./fileC";\n\nexport function foo(): void {\n\tbar();\n}\n',
	"src/fileC.ts": "export function bar(): void {}\n",
	"src/typeDef.ts": "export type Shape = { sides: number };\n",
	"src/typeUser.ts":
		'import type { Shape } from "./typeDef";\n\nexport const square: Shape = { sides: 4 };\n',
	"src/external.ts":
		'import { something } from "some-package";\n\nexport const x = something;\n',
};

const A = "src/fileA.ts";
const B = "src/fileB.ts";
const C = "src/fileC.ts";

let graphSnapshot: GraphSnapshot;
let graph: DependencyGraph;

beforeAll(async () => {
	const repo = createRepo(FILES);
	unwrap(await indexRepo(repo.ports, ROOT));
	graphSnapshot = snapshot(repo.db);
	graph = buildGraph(graphSnapshot);
});

describe("buildGraph (from the code graph)", () => {
	test("has one node per stored file, repo-relative", () => {
		expect([...graph.nodes].sort()).toEqual(
			graphSnapshot.files.map((f) => f.path).sort(),
		);
		expect(graph.nodes.has(A)).toBe(true);
		expect(graph.nodes.size).toBe(Object.keys(FILES).length);
	});

	test("projects symbol edges onto file edges", () => {
		expect(graph.edges.get(A)?.has(B)).toBe(true);
		expect(graph.edges.get(A)?.has(C)).toBe(true);
		expect(graph.edges.get(B)?.has(C)).toBe(true);
		expect(graph.edges.get(C)).toBeUndefined();
	});

	test("weighs code that calls into a file at 1.0", () => {
		expect(graph.edges.get(A)?.get(B)).toBeCloseTo(1.0);
	});

	test("weighs import-only and type-only dependencies at 0.5", () => {
		expect(graph.edges.get("src/typeUser.ts")?.get("src/typeDef.ts")).toBe(0.5);
	});

	test("never adds unresolved packages or self edges", () => {
		expect(graph.edges.get("src/external.ts")?.size ?? 0).toBe(0);
		for (const [src, targets] of graph.edges) {
			expect(targets.has(src)).toBe(false);
			for (const dst of targets.keys()) expect(graph.nodes.has(dst)).toBe(true);
		}
	});

	test("an empty store gives an empty graph", () => {
		const empty = buildGraph({ files: [], nodes: [], edges: [] });
		expect(empty.nodes.size).toBe(0);
		expect(empty.edges.size).toBe(0);
	});
});

describe("pageRank", () => {
	test("returns scores for all nodes, summing to about 1", () => {
		const scores = pageRank(graph);
		for (const node of graph.nodes) expect(scores.has(node)).toBe(true);
		const total = [...scores.values()].reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1.0, 1);
	});

	test("personalization biases scores toward personalized nodes", () => {
		const personalization = new Map<string, number>([
			[A, 100],
			[B, 1],
			[C, 1],
		]);
		const personalized = pageRank(graph, { personalization });
		const uniform = pageRank(graph);
		expect(personalized.get(A) ?? 0).toBeGreaterThan(uniform.get(A) ?? 0);
	});

	test("returns empty map for empty graph", () => {
		const scores = pageRank({ nodes: new Set(), edges: new Map() });
		expect(scores.size).toBe(0);
	});

	test("respects custom dampingFactor and iterations options", () => {
		const scores = pageRank(graph, { dampingFactor: 0.5, iterations: 5 });
		const total = [...scores.values()].reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1.0, 1);
	});
});

describe("scoreRelevance", () => {
	test("ranks touched files higher", () => {
		const task: TaskContext = {
			touchedFiles: [C],
			mentionedFiles: [],
			currentTicketTerms: [],
		};
		const scores = scoreRelevance(graph, task);
		expect(scores.get(C) ?? 0).toBeGreaterThan(pageRank(graph).get(C) ?? 0);
	});

	test("mentioned files get boosted scores (though less than touched)", () => {
		const touchedA = scoreRelevance(graph, {
			touchedFiles: [A],
			mentionedFiles: [B, C],
			currentTicketTerms: [],
		});
		const mentionedA = scoreRelevance(graph, {
			touchedFiles: [B, C],
			mentionedFiles: [A],
			currentTicketTerms: [],
		});
		expect(touchedA.get(A) ?? 0).toBeGreaterThan(mentionedA.get(A) ?? 0);
	});

	test("returns scores summing to approximately 1", () => {
		const scores = scoreRelevance(graph, {
			touchedFiles: [A],
			mentionedFiles: [B],
			currentTicketTerms: ["doA", "foo"],
		});
		const total = [...scores.values()].reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1.0, 1);
	});
});
