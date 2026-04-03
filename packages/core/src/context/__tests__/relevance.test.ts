import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildGraph,
	pageRank,
	scoreRelevance,
	type TaskContext,
} from "../relevance";

const TEST_DIR = join(tmpdir(), `maina-relevance-test-${Date.now()}`);

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });

	// Create a simple dependency graph of TS files for testing
	// fileA imports fileB and fileC
	// fileB imports fileC
	// fileC has no imports
	writeFileSync(
		join(TEST_DIR, "fileA.ts"),
		`import { foo } from "./fileB";\nimport { bar } from "./fileC";\nexport function doA() {}\n`,
	);
	writeFileSync(
		join(TEST_DIR, "fileB.ts"),
		`import { bar } from "./fileC";\nexport function foo() {}\n`,
	);
	writeFileSync(join(TEST_DIR, "fileC.ts"), `export function bar() {}\n`);
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("buildGraph", () => {
	test("creates nodes for each file", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		expect(graph.nodes.has(join(TEST_DIR, "fileA.ts"))).toBe(true);
		expect(graph.nodes.has(join(TEST_DIR, "fileB.ts"))).toBe(true);
		expect(graph.nodes.has(join(TEST_DIR, "fileC.ts"))).toBe(true);
		expect(graph.nodes.size).toBe(3);
	});

	test("creates edges between files with imports", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		// fileA imports fileB and fileC
		const aEdges = graph.edges.get(join(TEST_DIR, "fileA.ts"));
		expect(aEdges).toBeDefined();
		expect(aEdges?.has(join(TEST_DIR, "fileB.ts"))).toBe(true);
		expect(aEdges?.has(join(TEST_DIR, "fileC.ts"))).toBe(true);

		// fileB imports fileC
		const bEdges = graph.edges.get(join(TEST_DIR, "fileB.ts"));
		expect(bEdges?.has(join(TEST_DIR, "fileC.ts"))).toBe(true);
	});

	test("assigns weight 1.0 for normal imports", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		const aEdges = graph.edges.get(join(TEST_DIR, "fileA.ts"));
		const weightToB = aEdges?.get(join(TEST_DIR, "fileB.ts"));
		expect(weightToB).toBeCloseTo(1.0);
	});

	test("assigns weight 0.5 for type-only imports", async () => {
		const typeFile = join(TEST_DIR, "typeImporter.ts");
		const typeTarget = join(TEST_DIR, "typeTarget.ts");
		writeFileSync(
			typeFile,
			`import type { SomeType } from "./typeTarget";\nexport const x = 1;\n`,
		);
		writeFileSync(typeTarget, `export type SomeType = string;\n`);

		const graph = await buildGraph([typeFile, typeTarget]);

		const edges = graph.edges.get(typeFile);
		const weight = edges?.get(typeTarget);
		expect(weight).toBeCloseTo(0.5);
	});

	test("assigns weight 0.1 for private name imports (starting with _)", async () => {
		const privateFile = join(TEST_DIR, "privateImporter.ts");
		const privateTarget = join(TEST_DIR, "privateTarget.ts");
		writeFileSync(
			privateFile,
			`import { _helper } from "./privateTarget";\nexport const x = 1;\n`,
		);
		writeFileSync(privateTarget, `export function _helper() {}\n`);

		const graph = await buildGraph([privateFile, privateTarget]);

		const edges = graph.edges.get(privateFile);
		const weight = edges?.get(privateTarget);
		expect(weight).toBeCloseTo(0.1);
	});

	test("ignores non-relative imports (node_modules)", async () => {
		const extFile = join(TEST_DIR, "externalImporter.ts");
		writeFileSync(
			extFile,
			`import { something } from "some-package";\nexport const x = 1;\n`,
		);

		const graph = await buildGraph([extFile]);

		// The external package should not be added as a node or edge
		const edges = graph.edges.get(extFile);
		// No edges to external packages
		expect(edges?.size ?? 0).toBe(0);
	});

	test("returns empty graph for empty file list", async () => {
		const graph = await buildGraph([]);
		expect(graph.nodes.size).toBe(0);
		expect(graph.edges.size).toBe(0);
	});
});

describe("pageRank", () => {
	test("returns scores for all nodes", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);
		const scores = pageRank(graph);

		expect(scores.has(join(TEST_DIR, "fileA.ts"))).toBe(true);
		expect(scores.has(join(TEST_DIR, "fileB.ts"))).toBe(true);
		expect(scores.has(join(TEST_DIR, "fileC.ts"))).toBe(true);
	});

	test("returns scores that sum approximately to 1", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);
		const scores = pageRank(graph);

		const total = Array.from(scores.values()).reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1.0, 1);
	});

	test("pageRank with personalization biases scores toward personalized nodes", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		// Personalize heavily toward fileA
		const personalization = new Map<string, number>([
			[join(TEST_DIR, "fileA.ts"), 100],
			[join(TEST_DIR, "fileB.ts"), 1],
			[join(TEST_DIR, "fileC.ts"), 1],
		]);

		const scoresPersonalized = pageRank(graph, { personalization });
		const scoresUniform = pageRank(graph);

		const aScorePersonalized =
			scoresPersonalized.get(join(TEST_DIR, "fileA.ts")) ?? 0;
		const aScoreUniform = scoresUniform.get(join(TEST_DIR, "fileA.ts")) ?? 0;

		// fileA should have higher score when personalized toward it
		expect(aScorePersonalized).toBeGreaterThan(aScoreUniform);
	});

	test("pageRank without personalization distributes scores more evenly", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		// No personalization — uniform distribution baseline
		const scoresUniform = pageRank(graph);

		// With extreme personalization toward fileC (heavily-linked target),
		// fileC should dominate more than in the uniform case.
		const personalization = new Map<string, number>([
			[join(TEST_DIR, "fileA.ts"), 1],
			[join(TEST_DIR, "fileB.ts"), 1],
			[join(TEST_DIR, "fileC.ts"), 1000],
		]);
		const scoresPersonalized = pageRank(graph, { personalization });

		// fileC score should be higher when personalized toward it
		const cUniform = scoresUniform.get(join(TEST_DIR, "fileC.ts")) ?? 0;
		const cPersonalized =
			scoresPersonalized.get(join(TEST_DIR, "fileC.ts")) ?? 0;
		expect(cPersonalized).toBeGreaterThan(cUniform);

		// fileA score (not personalized heavily) should be lower in personalized run
		const aUniform = scoresUniform.get(join(TEST_DIR, "fileA.ts")) ?? 0;
		const aPersonalized =
			scoresPersonalized.get(join(TEST_DIR, "fileA.ts")) ?? 0;
		expect(aPersonalized).toBeLessThan(aUniform);
	});

	test("returns empty map for empty graph", () => {
		const graph = {
			nodes: new Set<string>(),
			edges: new Map<string, Map<string, number>>(),
		};
		const scores = pageRank(graph);
		expect(scores.size).toBe(0);
	});

	test("respects custom dampingFactor and iterations options", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		// Should not throw with custom options
		const scores = pageRank(graph, { dampingFactor: 0.5, iterations: 5 });
		const total = Array.from(scores.values()).reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1.0, 1);
	});
});

describe("scoreRelevance", () => {
	test("ranks touched files higher", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		const taskContext: TaskContext = {
			touchedFiles: [join(TEST_DIR, "fileC.ts")],
			mentionedFiles: [],
			currentTicketTerms: [],
		};

		const scores = scoreRelevance(graph, taskContext);

		// fileC is touched, should rank higher than without personalization
		const cScore = scores.get(join(TEST_DIR, "fileC.ts")) ?? 0;
		const uniformScores = pageRank(graph);
		const cUniformScore = uniformScores.get(join(TEST_DIR, "fileC.ts")) ?? 0;

		expect(cScore).toBeGreaterThan(cUniformScore);
	});

	test("mentioned files get boosted scores (though less than touched)", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		// Task1: fileA is touched (weight 50), fileB/fileC are mentioned (weight 10 each)
		const taskWithTouched: TaskContext = {
			touchedFiles: [join(TEST_DIR, "fileA.ts")],
			mentionedFiles: [join(TEST_DIR, "fileB.ts"), join(TEST_DIR, "fileC.ts")],
			currentTicketTerms: [],
		};

		// Task2: fileA is mentioned (weight 10), fileB/fileC are touched (weight 50 each)
		const taskWithMentioned: TaskContext = {
			touchedFiles: [join(TEST_DIR, "fileB.ts"), join(TEST_DIR, "fileC.ts")],
			mentionedFiles: [join(TEST_DIR, "fileA.ts")],
			currentTicketTerms: [],
		};

		const scoresTouched = scoreRelevance(graph, taskWithTouched);
		const scoresMentioned = scoreRelevance(graph, taskWithMentioned);

		const aTouched = scoresTouched.get(join(TEST_DIR, "fileA.ts")) ?? 0;
		const aMentioned = scoresMentioned.get(join(TEST_DIR, "fileA.ts")) ?? 0;

		// When fileA is touched (weight 50), it should score higher than when only mentioned (weight 10)
		expect(aTouched).toBeGreaterThan(aMentioned);
	});

	test("returns scores summing to approximately 1", async () => {
		const files = [
			join(TEST_DIR, "fileA.ts"),
			join(TEST_DIR, "fileB.ts"),
			join(TEST_DIR, "fileC.ts"),
		];
		const graph = await buildGraph(files);

		const taskContext: TaskContext = {
			touchedFiles: [join(TEST_DIR, "fileA.ts")],
			mentionedFiles: [join(TEST_DIR, "fileB.ts")],
			currentTicketTerms: ["doA", "foo"],
		};

		const scores = scoreRelevance(graph, taskContext);
		const total = Array.from(scores.values()).reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1.0, 1);
	});
});
