/**
 * Symbol search over the graph (FR-GRAPH-4). The query splits on
 * whitespace; a node matches when every term does, case-insensitively, and
 * scores the sum of its terms' best tiers below. Ties go to code over tests,
 * then to the smaller id.
 */

import type { Result } from "../../db/index";
import type { GraphNode } from "../store/schema";
import type { GraphStoreError } from "../store/types";
import { byId, type GraphIndex, isTestish, loadIndex, toRef } from "./graph";
import type { GraphReadPorts, SearchHit, SearchOptions } from "./types";

const DEFAULT_LIMIT = 20;

/** Best tier a term reaches on a node, or 0 when it does not appear at all. */
function termScore(term: string, node: GraphNode): number {
	const name = node.name.toLowerCase();
	const qualified = node.qualifiedName.toLowerCase();
	if (name === term) return 100;
	if (qualified === term) return 90;
	if (name.startsWith(term)) return 80;
	if (name.includes(term)) return 60;
	if (qualified.includes(term)) return 40;
	if (node.path.toLowerCase().includes(term)) return 20;
	return 0;
}

function scoreOf(terms: readonly string[], node: GraphNode): number {
	let total = 0;
	for (const term of terms) {
		const s = termScore(term, node);
		if (s === 0) return 0;
		total += s;
	}
	return total;
}

/** Pure search over an indexed graph. */
export function searchIndex(
	index: GraphIndex,
	query: string,
	options: SearchOptions = {},
): readonly SearchHit[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [];
	const includeTests = options.includeTests ?? true;
	const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_LIMIT));
	const hits: SearchHit[] = [];
	for (const node of index.nodes) {
		const test = isTestish(index, node);
		if (test && !includeTests) continue;
		const score = scoreOf(terms, node);
		if (score > 0) hits.push({ ...toRef(node), test, score });
	}
	return hits
		.sort(
			(a, b) =>
				b.score - a.score || Number(a.test) - Number(b.test) || byId(a, b),
		)
		.slice(0, limit);
}

/** Nodes (symbols, tests and files) matching `query`, best first. */
export function search(
	ports: GraphReadPorts,
	query: string,
	options: SearchOptions = {},
): Result<readonly SearchHit[], GraphStoreError> {
	const index = loadIndex(ports.db);
	if (!index.ok) return index;
	return { ok: true, value: searchIndex(index.value, query, options) };
}
