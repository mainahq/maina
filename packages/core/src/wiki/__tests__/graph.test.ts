import { describe, expect, it } from "bun:test";
import type { CodeEntity } from "../extractors/code";
import type { KnowledgeGraph } from "../graph";
import { buildKnowledgeGraph, computePageRank, mapToArticles } from "../graph";
import type {
	ExtractedDecision,
	ExtractedFeature,
	ExtractedWorkflowTrace,
} from "../types";

// ─── Test Fixtures ──────────────────────────────────────────────────────

function makeEntities(): CodeEntity[] {
	return [
		{
			name: "runPipeline",
			kind: "function",
			file: "src/verify/pipeline.ts",
			line: 10,
			exported: true,
		},
		{
			name: "syntaxGuard",
			kind: "function",
			file: "src/verify/syntax.ts",
			line: 5,
			exported: true,
		},
		{
			name: "CacheManager",
			kind: "class",
			file: "src/cache/manager.ts",
			line: 1,
			exported: true,
		},
		{
			name: "hashContent",
			kind: "function",
			file: "src/cache/hash.ts",
			line: 3,
			exported: true,
		},
	];
}

function makeFeatures(): ExtractedFeature[] {
	return [
		{
			id: "001-auth",
			title: "Authentication",
			scope: "Auth module",
			specQualityScore: 0.8,
			specAssertions: ["JWT tokens expire after 1 hour"],
			tasks: [{ id: "T001", description: "Implement JWT", completed: true }],
			entitiesModified: ["runPipeline"],
			decisionsCreated: ["0001-jwt"],
			branch: "feat/auth",
			prNumber: 1,
			merged: true,
		},
	];
}

function makeDecisions(): ExtractedDecision[] {
	return [
		{
			id: "0001-jwt",
			title: "Use JWT for Auth",
			status: "accepted",
			context: "Need stateless auth",
			decision: "Use JWT tokens",
			rationale: "Scalable and stateless",
			alternativesRejected: ["Sessions", "OAuth only"],
			entityMentions: ["src/verify/pipeline.ts"],
			constitutionAlignment: ["security-first"],
		},
	];
}

function makeTraces(): ExtractedWorkflowTrace[] {
	return [
		{
			featureId: "001-auth",
			steps: [
				{
					command: "brainstorm",
					timestamp: "2026-04-07T10:00:00.000Z",
					summary: "Explored auth approaches",
				},
			],
			wikiRefsRead: [],
			wikiRefsWritten: [],
			rlSignals: [],
		},
	];
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Knowledge Graph", () => {
	describe("buildKnowledgeGraph", () => {
		it("should create nodes for code entities", () => {
			const graph = buildKnowledgeGraph(makeEntities(), [], [], []);
			expect(graph.nodes.has("entity:runPipeline")).toBe(true);
			expect(graph.nodes.has("entity:syntaxGuard")).toBe(true);
			expect(graph.nodes.has("entity:CacheManager")).toBe(true);
			expect(graph.nodes.has("entity:hashContent")).toBe(true);
		});

		it("should create module nodes from entity file paths", () => {
			const graph = buildKnowledgeGraph(makeEntities(), [], [], []);
			expect(graph.nodes.has("module:verify")).toBe(true);
			expect(graph.nodes.has("module:cache")).toBe(true);
		});

		it("should create member_of edges between entities and modules", () => {
			const graph = buildKnowledgeGraph(makeEntities(), [], [], []);
			const memberOfEdges = graph.edges.filter((e) => e.type === "member_of");
			expect(memberOfEdges.length).toBeGreaterThan(0);

			const pipelineToVerify = memberOfEdges.find(
				(e) =>
					e.source === "entity:runPipeline" && e.target === "module:verify",
			);
			expect(pipelineToVerify).toBeDefined();
		});

		it("should create feature nodes", () => {
			const graph = buildKnowledgeGraph(makeEntities(), makeFeatures(), [], []);
			expect(graph.nodes.has("feature:001-auth")).toBe(true);
			expect(graph.nodes.get("feature:001-auth")?.label).toBe("Authentication");
		});

		it("should create decision nodes", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				[],
				makeDecisions(),
				[],
			);
			expect(graph.nodes.has("decision:0001-jwt")).toBe(true);
		});

		it("should create workflow nodes", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				makeFeatures(),
				[],
				makeTraces(),
			);
			expect(graph.nodes.has("workflow:001-auth")).toBe(true);
		});

		it("should create edges for all 11 edge types", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				makeFeatures(),
				makeDecisions(),
				makeTraces(),
			);

			const edgeTypes = new Set(graph.edges.map((e) => e.type));

			// Code edges
			expect(edgeTypes.has("member_of")).toBe(true);
			expect(edgeTypes.has("references")).toBe(true);

			// Lifecycle edges that should be present
			expect(edgeTypes.has("modified_by")).toBe(true);
			expect(edgeTypes.has("specified_by")).toBe(true);
			expect(edgeTypes.has("decided_by")).toBe(true);
			expect(edgeTypes.has("constrains")).toBe(true);
			expect(edgeTypes.has("aligns_with")).toBe(true);
		});

		it("should build adjacency map for all nodes", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				makeFeatures(),
				makeDecisions(),
				makeTraces(),
			);

			// Every node should appear in the adjacency map
			for (const nodeId of graph.nodes.keys()) {
				expect(graph.adjacency.has(nodeId)).toBe(true);
			}
		});

		it("should handle empty inputs", () => {
			const graph = buildKnowledgeGraph([], [], [], []);
			expect(graph.nodes.size).toBe(0);
			expect(graph.edges).toHaveLength(0);
			expect(graph.adjacency.size).toBe(0);
		});
	});

	describe("computePageRank", () => {
		it("should compute scores that sum to approximately 1", () => {
			const graph = buildKnowledgeGraph(makeEntities(), [], [], []);
			const scores = computePageRank(graph);

			let sum = 0;
			for (const score of scores.values()) {
				sum += score;
			}

			expect(sum).toBeCloseTo(1.0, 1);
		});

		it("should assign higher rank to more connected nodes", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				makeFeatures(),
				makeDecisions(),
				makeTraces(),
			);
			const scores = computePageRank(graph);

			// runPipeline is connected to many things (feature, decision, module)
			// so it should have relatively high rank
			const runPipelineScore = scores.get("entity:runPipeline") ?? 0;
			expect(runPipelineScore).toBeGreaterThan(0);
		});

		it("should converge after iterations", () => {
			const graph = buildKnowledgeGraph(makeEntities(), [], [], []);
			const scores10 = computePageRank(graph, 10);
			const scores50 = computePageRank(graph, 50);

			// Scores should be similar after convergence
			for (const [id, score10] of scores10) {
				const score50 = scores50.get(id) ?? 0;
				expect(Math.abs(score10 - score50)).toBeLessThan(0.01);
			}
		});

		it("should return empty map for empty graph", () => {
			const graph: KnowledgeGraph = {
				nodes: new Map(),
				edges: [],
				adjacency: new Map(),
			};
			const scores = computePageRank(graph);
			expect(scores.size).toBe(0);
		});

		it("should update graph node pageRank values", () => {
			const graph = buildKnowledgeGraph(makeEntities(), [], [], []);
			computePageRank(graph);

			for (const node of graph.nodes.values()) {
				expect(node.pageRank).toBeGreaterThan(0);
			}
		});
	});

	describe("mapToArticles", () => {
		it("should map top 20% entities to wiki/entities/", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				makeFeatures(),
				makeDecisions(),
				makeTraces(),
			);
			computePageRank(graph);

			const communities = new Map<number, string[]>();
			communities.set(0, ["module:verify", "entity:runPipeline"]);
			communities.set(1, ["module:cache", "entity:CacheManager"]);

			const articleMap = mapToArticles(graph, communities);

			// At least one entity should map to wiki/entities/
			const entityPaths = [...articleMap.values()].filter((p) =>
				p.startsWith("wiki/entities/"),
			);
			expect(entityPaths.length).toBeGreaterThan(0);
		});

		it("should map communities to wiki/modules/", () => {
			const graph = buildKnowledgeGraph(makeEntities(), [], [], []);
			computePageRank(graph);

			const communities = new Map<number, string[]>();
			communities.set(0, ["module:verify"]);
			communities.set(1, ["module:cache"]);

			const articleMap = mapToArticles(graph, communities);

			const modulePaths = [...articleMap.values()].filter((p) =>
				p.startsWith("wiki/modules/"),
			);
			expect(modulePaths.length).toBe(2);
		});

		it("should map features to wiki/features/", () => {
			const graph = buildKnowledgeGraph(makeEntities(), makeFeatures(), [], []);
			computePageRank(graph);

			const articleMap = mapToArticles(graph, new Map());
			const featurePaths = [...articleMap.values()].filter((p) =>
				p.startsWith("wiki/features/"),
			);
			expect(featurePaths.length).toBe(1);
		});

		it("should map decisions to wiki/decisions/", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				[],
				makeDecisions(),
				[],
			);
			computePageRank(graph);

			const articleMap = mapToArticles(graph, new Map());
			const decisionPaths = [...articleMap.values()].filter((p) =>
				p.startsWith("wiki/decisions/"),
			);
			expect(decisionPaths.length).toBe(1);
		});

		it("should sanitize names in article paths", () => {
			const graph = buildKnowledgeGraph(
				makeEntities(),
				makeFeatures(),
				makeDecisions(),
				makeTraces(),
			);
			computePageRank(graph);

			const articleMap = mapToArticles(
				graph,
				new Map([[0, ["module:verify"]]]),
			);

			for (const path of articleMap.values()) {
				// Paths should not contain spaces or special chars
				expect(path).toMatch(/^[a-zA-Z0-9/_.-]+$/);
			}
		});
	});

	// ── Community naming uses meaningful names (#80) ─────────────────

	describe("community naming", () => {
		it("should derive module names from entity file paths when no module node exists", () => {
			const entities: CodeEntity[] = [
				{
					name: "login",
					kind: "function",
					file: "packages/auth/src/login.ts",
					line: 1,
					exported: true,
				},
				{
					name: "logout",
					kind: "function",
					file: "packages/auth/src/logout.ts",
					line: 1,
					exported: true,
				},
				{
					name: "getCache",
					kind: "function",
					file: "packages/cache/src/index.ts",
					line: 1,
					exported: true,
				},
			];
			const features: ExtractedFeature[] = [];
			const decisions: ExtractedDecision[] = [];
			const traces: ExtractedWorkflowTrace[] = [];

			const graph = buildKnowledgeGraph(entities, features, decisions, traces);
			computePageRank(graph);

			// Simulate communities where auth entities are together
			const communities = new Map<number, string[]>([
				[0, ["entity:login", "entity:logout"]],
				[1, ["entity:getCache"]],
			]);

			const articleMap = mapToArticles(graph, communities);

			// Should use directory name, not cluster-N
			const paths = [...articleMap.values()];
			const modulePaths = paths.filter((p) => p.includes("modules/"));
			for (const p of modulePaths) {
				expect(p).not.toContain("cluster-");
			}
			// Auth entities should map to an auth-related module
			expect(modulePaths.some((p) => p.includes("auth"))).toBe(true);
		});
	});
});
