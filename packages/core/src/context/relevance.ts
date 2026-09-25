import { decide, defaultDecidePorts, scoreAnswers } from "../decide/decide";
import type { EdgeKind } from "../graph/store/schema";
import type { GraphSnapshot } from "../graph/store/types";

export { pageRank } from "../decide/backends/heuristics/retrieval";

export interface DependencyGraph {
	nodes: Set<string>; // file paths
	edges: Map<string, Map<string, number>>; // source -> target -> weight
}

export type TaskContext = Readonly<{
	touchedFiles: readonly string[];
	mentionedFiles: readonly string[];
	currentTicketTerms: readonly string[];
}>;

/**
 * How strongly an edge ties its source file to its target's file. Using the
 * target's code (a call, extending a type) is a hard dependency; an import
 * alone (a re-export, a type-only import) or a type reference is a soft one.
 */
const EDGE_WEIGHT: Readonly<Record<EdgeKind, number>> = {
	calls: 1,
	inherits: 1,
	imports: 0.5,
	references: 0.5,
};

/**
 * The code graph's file-level projection, the PageRank input (FR-GRAPH-5):
 * one node per stored file and an edge from each file to every other file
 * its symbols import, call, reference or extend, weighted by the strongest
 * such tie (see `EDGE_WEIGHT`). Paths are repo-relative, as stored. Pure.
 */
export function buildGraph(snapshot: GraphSnapshot): DependencyGraph {
	const nodes = new Set(snapshot.files.map((f) => f.path));
	const pathOf = new Map(snapshot.nodes.map((n) => [n.id, n.path]));
	const edges = new Map<string, Map<string, number>>();
	for (const edge of snapshot.edges) {
		const target = pathOf.get(edge.dst);
		if (target === undefined || target === edge.path) continue;
		if (!nodes.has(edge.path) || !nodes.has(target)) continue;
		const targets = edges.get(edge.path) ?? new Map<string, number>();
		const weight = Math.max(targets.get(target) ?? 0, EDGE_WEIGHT[edge.kind]);
		targets.set(target, weight);
		edges.set(edge.path, targets);
	}
	return { nodes, edges };
}

/**
 * Scores every file's relevance to the task via `decide` (`context.select`):
 * the heuristic backend runs personalised PageRank, touched files weighing
 * 50 and mentioned files 10. Returns file → score in graph node order.
 */
export function scoreRelevance(
	graph: DependencyGraph,
	taskContext: TaskContext,
): Map<string, number> {
	const nodes = Array.from(graph.nodes);
	if (nodes.length === 0) return new Map();

	const edges: Array<[string, string, number]> = [];
	for (const [source, targets] of graph.edges) {
		for (const [target, weight] of targets) {
			edges.push([source, target, weight]);
		}
	}
	const result = decide(defaultDecidePorts, {
		type: "context.select",
		state: {
			trusted: {
				nodes,
				edges,
				touched: taskContext.touchedFiles,
				mentioned: taskContext.mentionedFiles,
			},
			untrusted: {},
		},
		questions: nodes.map((_, i) => ({
			kind: "score",
			id: `file:${i}`,
			min: 0,
			max: 1,
		})),
	});
	const scores = scoreAnswers(result, nodes.length, 0);
	return new Map(nodes.map((node, i) => [node, scores[i] ?? 0]));
}
