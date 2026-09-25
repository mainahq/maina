/**
 * Retrieval heuristics: `wiki.relevance` (keyword overlap with an article)
 * and `context.select` (personalised PageRank over the import graph).
 */

import type { Result } from "../../../db/index";
import type {
	BackendAnswer,
	BackendError,
	DecisionState,
	Question,
} from "../../types";
import {
	answerEach,
	asNumber,
	asStringArray,
	candidate,
	degenerate,
	parseQuestionId,
	thresholdAnswer,
	unsupported,
} from "../distribution";

// ── wiki.relevance ──────────────────────────────────────────────────────────

/** An article is relevant when over a fifth of the query keywords hit it. */
const ARTICLE_RELEVANCE = 0.2;

/**
 * Share of `keywords` that overlap (either contains the other) at least one
 * of the article's tokens. Duplicated keywords count every time.
 */
function keywordOverlap(
	tokens: readonly string[],
	keywords: readonly string[],
): number {
	if (keywords.length === 0) return 0;
	let matches = 0;
	for (const kw of keywords) {
		if (tokens.some((t) => t.includes(kw) || kw.includes(t))) matches++;
	}
	return matches / keywords.length;
}

/**
 * Question `article:<k>`; state.untrusted.keywords (the tokenised query) and
 * state.untrusted.candidates[k].tokens (the article's distinct tokens).
 */
export function wikiRelevance(
	state: DecisionState,
	questions: readonly Question[],
): Result<readonly BackendAnswer[], BackendError> {
	const keywords = asStringArray(state.untrusted.keywords);
	return answerEach(questions, (q) => {
		const { check, subject } = parseQuestionId(q.id);
		const tokens = asStringArray(
			candidate(state, "untrusted", subject)?.tokens,
		);
		if (q.kind !== "bool" || check !== "article") return undefined;
		if (keywords === undefined || tokens === undefined) return undefined;
		const score = keywordOverlap(tokens, keywords);
		return thresholdAnswer(score, ARTICLE_RELEVANCE, true, true);
	});
}

// ── context.select ──────────────────────────────────────────────────────────

/** A dependency graph as PageRank reads it: edges are source → target → weight. */
type RankGraph = Readonly<{
	nodes: Iterable<string>;
	edges: ReadonlyMap<string, ReadonlyMap<string, number>>;
}>;

/** Personalisation weight of a file the task touches. */
const TOUCHED_WEIGHT = 50;
/** Personalisation weight of a file the task mentions. */
const MENTIONED_WEIGHT = 10;

/**
 * PageRank over a dependency graph. Returns file → score, scores summing to
 * approximately 1.
 *
 *   score[n] = (1 - d) * personalWeight[n] / totalPersonalWeight
 *            + d * sum(score[m] / outDegree(m) for m that links to n)
 */
export function pageRank(
	graph: RankGraph,
	options?: {
		personalization?: ReadonlyMap<string, number>;
		dampingFactor?: number;
		iterations?: number;
	},
): Map<string, number> {
	const nodes = Array.from(graph.nodes);
	const n = nodes.length;

	if (n === 0) {
		return new Map();
	}

	const d = options?.dampingFactor ?? 0.85;
	const iters = options?.iterations ?? 20;
	const personalization = options?.personalization;

	// Build personalization weights
	const personalWeights = new Map<string, number>();
	let totalPersonalWeight = 0;

	if (personalization && personalization.size > 0) {
		for (const node of nodes) {
			const w = personalization.get(node) ?? 0;
			personalWeights.set(node, w);
			totalPersonalWeight += w;
		}
		// If all personalized nodes are not in graph, fall back to uniform
		if (totalPersonalWeight === 0) {
			for (const node of nodes) {
				personalWeights.set(node, 1);
				totalPersonalWeight += 1;
			}
		}
	} else {
		// Uniform personalization
		for (const node of nodes) {
			personalWeights.set(node, 1);
		}
		totalPersonalWeight = n;
	}

	// Compute out-degrees (weighted)
	const outDegree = new Map<string, number>();
	for (const node of nodes) {
		const targets = graph.edges.get(node);
		if (targets && targets.size > 0) {
			let total = 0;
			for (const w of targets.values()) {
				total += w;
			}
			outDegree.set(node, total);
		} else {
			outDegree.set(node, 0);
		}
	}

	// Build reverse adjacency: target -> list of (source, weight)
	const inLinks = new Map<string, Array<[string, number]>>();
	for (const node of nodes) {
		inLinks.set(node, []);
	}
	for (const [source, targets] of graph.edges) {
		for (const [target, weight] of targets) {
			if (inLinks.has(target)) {
				inLinks.get(target)?.push([source, weight]);
			}
		}
	}

	// Initialize scores
	let scores = new Map<string, number>();
	for (const node of nodes) {
		scores.set(node, 1 / n);
	}

	// Dangling nodes (no outgoing edges) — redistribute uniformly
	const danglingNodes = nodes.filter((node) => outDegree.get(node) === 0);

	// Iterate
	for (let iter = 0; iter < iters; iter++) {
		const newScores = new Map<string, number>();

		// Sum of dangling node scores
		let danglingSum = 0;
		for (const node of danglingNodes) {
			danglingSum += scores.get(node) ?? 0;
		}

		for (const node of nodes) {
			const personalBase =
				((1 - d) * (personalWeights.get(node) ?? 0)) / totalPersonalWeight;

			// Dangling node contribution distributed by personalization
			const danglingContrib =
				d *
				danglingSum *
				((personalWeights.get(node) ?? 0) / totalPersonalWeight);

			// Link contributions
			let linkSum = 0;
			const incoming = inLinks.get(node) ?? [];
			for (const [source, weight] of incoming) {
				const sourceOut = outDegree.get(source) ?? 0;
				if (sourceOut > 0) {
					linkSum += d * (scores.get(source) ?? 0) * (weight / sourceOut);
				}
			}

			newScores.set(node, personalBase + danglingContrib + linkSum);
		}

		scores = newScores;
	}

	// Normalize so scores sum to 1
	let total = 0;
	for (const v of scores.values()) {
		total += v;
	}
	if (total > 0) {
		for (const [node, v] of scores) {
			scores.set(node, v / total);
		}
	}

	return scores;
}

/** `[source, target, weight]` triples in the graph's iteration order. */
function edgeMap(
	value: unknown,
): ReadonlyMap<string, ReadonlyMap<string, number>> | undefined {
	if (!Array.isArray(value)) return undefined;
	const edges = new Map<string, Map<string, number>>();
	for (const edge of value) {
		if (!Array.isArray(edge) || edge.length !== 3) return undefined;
		const [source, target, weight] = edge as readonly unknown[];
		const w = asNumber(weight);
		if (typeof source !== "string" || typeof target !== "string") {
			return undefined;
		}
		if (w === undefined) return undefined;
		const targets = edges.get(source) ?? new Map<string, number>();
		targets.set(target, w);
		edges.set(source, targets);
	}
	return edges;
}

/**
 * Questions `file:<i>` (score in [0, 1]) for `nodes[i]`; state.trusted =
 * `{ nodes, edges, touched, mentioned }`. Touched files weigh 50 and
 * mentioned files 10 in the personalisation vector.
 */
export function contextSelect(
	state: DecisionState,
	questions: readonly Question[],
): Result<readonly BackendAnswer[], BackendError> {
	const nodes = asStringArray(state.trusted.nodes);
	const edges = edgeMap(state.trusted.edges);
	const touched = asStringArray(state.trusted.touched);
	const mentioned = asStringArray(state.trusted.mentioned);
	if (
		nodes === undefined ||
		edges === undefined ||
		touched === undefined ||
		mentioned === undefined
	) {
		return unsupported(
			undefined,
			"context.select needs nodes, edges, touched and mentioned",
		);
	}

	const personalization = new Map<string, number>();
	for (const file of touched) {
		personalization.set(
			file,
			(personalization.get(file) ?? 0) + TOUCHED_WEIGHT,
		);
	}
	for (const file of mentioned) {
		personalization.set(
			file,
			(personalization.get(file) ?? 0) + MENTIONED_WEIGHT,
		);
	}
	const scores = pageRank({ nodes, edges }, { personalization });

	return answerEach(questions, (q) => {
		const { check, subject } = parseQuestionId(q.id);
		const node =
			check === "file" && /^\d+$/.test(subject)
				? nodes[Number(subject)]
				: undefined;
		const score = node === undefined ? undefined : scores.get(node);
		if (q.kind !== "score" || score === undefined) return undefined;
		return score < q.min || score > q.max ? undefined : degenerate(q, score);
	});
}
