/**
 * Knowledge Graph — unified graph with 11 edge types for wiki compilation.
 *
 * Builds a graph from code entities, features, decisions, and workflow traces.
 * Supports PageRank computation and mapping graph nodes to wiki article paths.
 */

import type { CodeEntity } from "./extractors/code";
import type {
	EdgeType,
	ExtractedDecision,
	ExtractedFeature,
	ExtractedWorkflowTrace,
} from "./types";

// ─── Types ───────────────────────────────────────────────────────────────

export interface GraphNode {
	id: string;
	type: "entity" | "module" | "feature" | "decision" | "workflow";
	label: string;
	file?: string;
	pageRank: number;
}

export interface GraphEdge {
	source: string;
	target: string;
	type: EdgeType;
	weight: number;
}

export interface KnowledgeGraph {
	nodes: Map<string, GraphNode>;
	edges: GraphEdge[];
	adjacency: Map<string, Set<string>>;
}

// ─── Graph Construction ─────────────────────────────────────────────────

function addNode(graph: KnowledgeGraph, node: GraphNode): void {
	if (!graph.nodes.has(node.id)) {
		graph.nodes.set(node.id, node);
	}
	if (!graph.adjacency.has(node.id)) {
		graph.adjacency.set(node.id, new Set<string>());
	}
}

function addEdge(graph: KnowledgeGraph, edge: GraphEdge): void {
	graph.edges.push(edge);

	// Ensure both nodes are in adjacency
	if (!graph.adjacency.has(edge.source)) {
		graph.adjacency.set(edge.source, new Set<string>());
	}
	if (!graph.adjacency.has(edge.target)) {
		graph.adjacency.set(edge.target, new Set<string>());
	}

	graph.adjacency.get(edge.source)?.add(edge.target);
	graph.adjacency.get(edge.target)?.add(edge.source);
}

/**
 * Derive a meaningful module name from a file path (#80).
 *
 * Skips generic directories (src, lib, dist, etc.) to find a
 * semantically meaningful name. For monorepo paths like
 * "packages/auth/src/jwt.ts", returns "auth" instead of "src".
 *
 * "packages/auth/src/jwt.ts"     -> "auth"
 * "packages/core/src/wiki/state.ts" -> "wiki"
 * "src/auth/jwt.ts"              -> "auth"
 * "src/index.ts"                 -> "src"
 */
function deriveModule(file: string): string {
	const parts = file.replace(/\\/g, "/").split("/");
	if (parts.length < 2) return "root";

	const genericDirs = new Set([
		"src",
		"lib",
		"dist",
		"build",
		"test",
		"tests",
		"__tests__",
		"__mocks__",
	]);

	// Directories only (drop filename)
	const dirs = parts.slice(0, -1);

	// Walk from deepest to shallowest, return first non-generic name
	for (let i = dirs.length - 1; i >= 0; i--) {
		const dir = dirs[i];
		if (dir && !genericDirs.has(dir)) {
			return dir;
		}
	}

	return dirs[dirs.length - 1] ?? "root";
}

function addCodeEntities(graph: KnowledgeGraph, entities: CodeEntity[]): void {
	// Group entities by module (directory)
	const moduleEntities = new Map<string, CodeEntity[]>();

	for (const entity of entities) {
		const moduleName = deriveModule(entity.file);

		// Add entity node
		const entityId = `entity:${entity.name}`;
		addNode(graph, {
			id: entityId,
			type: "entity",
			label: entity.name,
			file: entity.file,
			pageRank: 0,
		});

		// Track module membership
		const list = moduleEntities.get(moduleName) ?? [];
		list.push(entity);
		moduleEntities.set(moduleName, list);
	}

	// Create module nodes and member_of edges
	for (const [moduleName, members] of moduleEntities) {
		const moduleId = `module:${moduleName}`;
		addNode(graph, {
			id: moduleId,
			type: "module",
			label: moduleName,
			pageRank: 0,
		});

		for (const member of members) {
			addEdge(graph, {
				source: `entity:${member.name}`,
				target: moduleId,
				type: "member_of",
				weight: 1.0,
			});
		}

		// Add imports edges between entities in the same file
		// (simplified: entities from the same file reference each other)
		const fileGroups = new Map<string, CodeEntity[]>();
		for (const member of members) {
			const fg = fileGroups.get(member.file) ?? [];
			fg.push(member);
			fileGroups.set(member.file, fg);
		}

		for (const fileEntities of fileGroups.values()) {
			for (let i = 0; i < fileEntities.length; i++) {
				for (let j = i + 1; j < fileEntities.length; j++) {
					const a = fileEntities[i];
					const b = fileEntities[j];
					if (a && b) {
						addEdge(graph, {
							source: `entity:${a.name}`,
							target: `entity:${b.name}`,
							type: "references",
							weight: 0.5,
						});
					}
				}
			}
		}
	}
}

function addFeatures(
	graph: KnowledgeGraph,
	features: ExtractedFeature[],
): void {
	for (const feature of features) {
		const featureId = `feature:${feature.id}`;
		addNode(graph, {
			id: featureId,
			type: "feature",
			label: feature.title || feature.id,
			pageRank: 0,
		});

		// Link to modified entities
		for (const entityName of feature.entitiesModified) {
			const entityId = `entity:${entityName}`;
			if (graph.nodes.has(entityId)) {
				addEdge(graph, {
					source: entityId,
					target: featureId,
					type: "modified_by",
					weight: 1.0,
				});
			}
		}

		// Link to created decisions
		for (const decisionName of feature.decisionsCreated) {
			const decisionId = `decision:${decisionName}`;
			if (graph.nodes.has(decisionId)) {
				addEdge(graph, {
					source: featureId,
					target: decisionId,
					type: "motivated_by",
					weight: 0.8,
				});
			}
		}

		// Spec assertions create specified_by edges
		if (feature.specAssertions.length > 0) {
			addEdge(graph, {
				source: featureId,
				target: featureId,
				type: "specified_by",
				weight: 0.3,
			});
		}
	}
}

function addDecisions(
	graph: KnowledgeGraph,
	decisions: ExtractedDecision[],
): void {
	for (const decision of decisions) {
		const decisionId = `decision:${decision.id}`;
		addNode(graph, {
			id: decisionId,
			type: "decision",
			label: decision.title || decision.id,
			pageRank: 0,
		});

		// Link to entity mentions
		for (const mention of decision.entityMentions) {
			// Try to find the entity by matching the end of the path
			for (const [nodeId, node] of graph.nodes) {
				if (node.type === "entity" && node.file === mention) {
					addEdge(graph, {
						source: nodeId,
						target: decisionId,
						type: "decided_by",
						weight: 0.8,
					});
				}
			}
		}

		// Constitution alignment creates aligns_with edges
		for (const alignment of decision.constitutionAlignment) {
			if (alignment) {
				addEdge(graph, {
					source: decisionId,
					target: decisionId,
					type: "aligns_with",
					weight: 0.2,
				});
			}
		}

		// If decision constrains entities, add constrains edges
		if (decision.status === "accepted") {
			for (const mention of decision.entityMentions) {
				for (const [nodeId, node] of graph.nodes) {
					if (node.type === "entity" && node.file === mention) {
						addEdge(graph, {
							source: decisionId,
							target: nodeId,
							type: "constrains",
							weight: 0.6,
						});
					}
				}
			}
		}
	}
}

function addWorkflowTraces(
	graph: KnowledgeGraph,
	traces: ExtractedWorkflowTrace[],
): void {
	for (const trace of traces) {
		if (!trace.featureId) continue;

		const workflowId = `workflow:${trace.featureId}`;
		addNode(graph, {
			id: workflowId,
			type: "workflow",
			label: `Workflow: ${trace.featureId}`,
			pageRank: 0,
		});

		// Link to the feature
		const featureId = `feature:${trace.featureId}`;
		if (graph.nodes.has(featureId)) {
			addEdge(graph, {
				source: workflowId,
				target: featureId,
				type: "references",
				weight: 0.5,
			});
		}
	}
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Build a unified knowledge graph from all extracted data.
 */
export function buildKnowledgeGraph(
	entities: CodeEntity[],
	features: ExtractedFeature[],
	decisions: ExtractedDecision[],
	traces: ExtractedWorkflowTrace[],
): KnowledgeGraph {
	const graph: KnowledgeGraph = {
		nodes: new Map(),
		edges: [],
		adjacency: new Map(),
	};

	addCodeEntities(graph, entities);
	addDecisions(graph, decisions);
	addFeatures(graph, features);
	addWorkflowTraces(graph, traces);

	return graph;
}

/**
 * Compute PageRank scores for all nodes in the graph.
 * Uses iterative power method with damping factor 0.85.
 */
export function computePageRank(
	graph: KnowledgeGraph,
	iterations = 20,
): Map<string, number> {
	const nodeIds = [...graph.nodes.keys()];
	const n = nodeIds.length;

	if (n === 0) return new Map();

	const damping = 0.85;
	const scores = new Map<string, number>();

	// Initialize with uniform distribution
	for (const id of nodeIds) {
		scores.set(id, 1 / n);
	}

	// Build outgoing edge map
	const outgoing = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const list = outgoing.get(edge.source) ?? [];
		list.push(edge.target);
		outgoing.set(edge.source, list);
	}

	// Iterative computation
	for (let iter = 0; iter < iterations; iter++) {
		const newScores = new Map<string, number>();

		for (const id of nodeIds) {
			newScores.set(id, (1 - damping) / n);
		}

		for (const id of nodeIds) {
			const outs = outgoing.get(id) ?? [];
			if (outs.length === 0) {
				// Dangling node: distribute evenly
				const share = (scores.get(id) ?? 0) / n;
				for (const target of nodeIds) {
					newScores.set(target, (newScores.get(target) ?? 0) + damping * share);
				}
			} else {
				const share = (scores.get(id) ?? 0) / outs.length;
				for (const target of outs) {
					newScores.set(target, (newScores.get(target) ?? 0) + damping * share);
				}
			}
		}

		// Update scores
		for (const [id, score] of newScores) {
			scores.set(id, score);
		}
	}

	// Update graph nodes with computed PageRank
	for (const [id, score] of scores) {
		const node = graph.nodes.get(id);
		if (node) {
			node.pageRank = score;
		}
	}

	return scores;
}

/**
 * Map graph nodes to wiki article paths based on PageRank and community assignment.
 * - Top 20% PageRank entities -> wiki/entities/
 * - Louvain clusters -> wiki/modules/
 * - Features -> wiki/features/
 * - Decisions -> wiki/decisions/
 */
export function mapToArticles(
	graph: KnowledgeGraph,
	communities: Map<number, string[]>,
): Map<string, string> {
	const articleMap = new Map<string, string>();

	// Compute PageRank threshold for top 20%
	const entityNodes = [...graph.nodes.entries()]
		.filter(([, node]) => node.type === "entity")
		.sort(([, a], [, b]) => b.pageRank - a.pageRank);

	const top20Idx = Math.max(1, Math.ceil(entityNodes.length * 0.2));
	const threshold =
		entityNodes.length > 0
			? (entityNodes[Math.min(top20Idx - 1, entityNodes.length - 1)]?.[1]
					?.pageRank ?? 0)
			: 0;

	// Map top 20% entities
	for (const [id, node] of entityNodes) {
		if (node.pageRank >= threshold && threshold > 0) {
			const safeName = node.label.replace(/[^a-zA-Z0-9_-]/g, "-");
			articleMap.set(id, `wiki/entities/${safeName}.md`);
		}
	}

	// Map Louvain clusters to module articles (#80)
	for (const [commId, members] of communities) {
		const moduleNodes = members.filter(
			(m) => graph.nodes.get(m)?.type === "module",
		);
		let label: string;
		if (
			moduleNodes.length > 0 &&
			graph.nodes.get(moduleNodes[0] ?? "")?.label
		) {
			label = graph.nodes.get(moduleNodes[0] ?? "")?.label ?? "";
		} else {
			// Derive from entity file paths — find the most common non-generic dir
			const entityMembers = members
				.filter((m) => graph.nodes.get(m)?.type === "entity")
				.map((m) => graph.nodes.get(m));
			const dirCounts = new Map<string, number>();
			const genericDirs = new Set([
				"src",
				"lib",
				"dist",
				"build",
				"test",
				"tests",
				"__tests__",
			]);
			for (const node of entityMembers) {
				if (!node?.file) continue;
				const parts = node.file.replace(/\\/g, "/").split("/");
				for (let i = parts.length - 2; i >= 0; i--) {
					const dir = parts[i];
					if (dir && !genericDirs.has(dir)) {
						dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
						break;
					}
				}
			}
			let bestDir = "";
			let bestCount = 0;
			for (const [dir, count] of dirCounts) {
				if (count > bestCount) {
					bestDir = dir;
					bestCount = count;
				}
			}
			label = bestDir || `cluster-${commId}`;
		}
		const safeName = label.replace(/[^a-zA-Z0-9_-]/g, "-");
		articleMap.set(`community:${commId}`, `wiki/modules/${safeName}.md`);
	}

	// Map features
	for (const [id, node] of graph.nodes) {
		if (node.type === "feature") {
			const safeName = node.label.replace(/[^a-zA-Z0-9_-]/g, "-");
			articleMap.set(id, `wiki/features/${safeName}.md`);
		}
	}

	// Map decisions
	for (const [id, node] of graph.nodes) {
		if (node.type === "decision") {
			const safeName = node.label.replace(/[^a-zA-Z0-9_-]/g, "-");
			articleMap.set(id, `wiki/decisions/${safeName}.md`);
		}
	}

	return articleMap;
}
