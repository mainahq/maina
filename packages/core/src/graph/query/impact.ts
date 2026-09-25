/**
 * Impact query (FR-GRAPH-3): what a change to some files or symbols can
 * break. Walks the graph backwards from the targets, over calls, references,
 * inheritance and imports, for up to `depth` hops.
 *
 * - Reached non-test code within range is a caller (a symbol) or makes its
 *   file a dependent (a symbol, or a file importing a target file).
 * - Reached tests are the tests covering the change. A test one hop past the
 *   range still counts when the node it exercises is in range, so every
 *   listed caller brings its own tests.
 * - Code in a test file that is not itself a test (a helper) is walked
 *   through, so tests reaching a target via a helper are found, but it is
 *   neither a caller nor a dependent.
 */

import type { Result } from "../../db/index";
import type { GraphNode } from "../store/schema";
import type { GraphStoreError } from "../store/types";
import {
	byId,
	type GraphIndex,
	isFileNode,
	isTestish,
	loadIndex,
	lookupSymbol,
	normalizePath,
	toRef,
	withMembers,
} from "./graph";
import type {
	GraphReadPorts,
	ImpactedNode,
	ImpactReport,
	ImpactRequest,
} from "./types";

const DEFAULT_DEPTH = 3;

type Targets = Readonly<{
	named: readonly GraphNode[];
	seeds: readonly GraphNode[];
	unknown: readonly string[];
}>;

function resolveTargets(index: GraphIndex, request: ImpactRequest): Targets {
	const named = new Map<string, GraphNode>();
	const seeds = new Map<string, GraphNode>();
	const unknown: string[] = [];
	for (const raw of request.files ?? []) {
		const path = normalizePath(raw);
		const nodes = index.byPath.get(path);
		const file = index.byId.get(path);
		if (nodes === undefined || file === undefined) {
			unknown.push(raw);
			continue;
		}
		named.set(file.id, file);
		for (const n of nodes) seeds.set(n.id, n);
	}
	for (const symbol of request.symbols ?? []) {
		const hits = lookupSymbol(index, symbol);
		if (hits.length === 0) unknown.push(symbol);
		for (const hit of hits) {
			named.set(hit.id, hit);
			for (const n of withMembers(index, hit)) seeds.set(n.id, n);
		}
	}
	return {
		named: [...named.values()].sort(byId),
		seeds: [...seeds.values()],
		unknown: [...new Set(unknown)].sort(),
	};
}

/** A test file's own node says nothing a case in that file does not. */
function dropCoveredTestFiles(
	tests: readonly ImpactedNode[],
): readonly ImpactedNode[] {
	const withCases = new Set(
		tests.filter((t) => t.kind !== "file").map((t) => t.path),
	);
	return tests.filter((t) => t.kind !== "file" || !withCases.has(t.path));
}

function blastScore(
	index: GraphIndex,
	seeds: readonly GraphNode[],
	dependents: readonly string[],
): number {
	const code = [...index.files.values()].filter((f) => !f.isTest);
	const seedPaths = new Set(seeds.map((s) => s.path));
	const others = code.filter((f) => !seedPaths.has(f.path)).length;
	if (others === 0) return 0;
	return Math.round((dependents.length / others) * 10_000) / 10_000;
}

/** Pure impact over an indexed graph. */
function impactOf(index: GraphIndex, request: ImpactRequest): ImpactReport {
	const depth = Math.max(0, Math.floor(request.depth ?? DEFAULT_DEPTH));
	const { named, seeds, unknown } = resolveTargets(index, request);
	const seen = new Set(seeds.map((s) => s.id));
	const seedPaths = new Set(seeds.map((s) => s.path));
	const callers: ImpactedNode[] = [];
	const tests: ImpactedNode[] = [];
	const dependents = new Set<string>();

	let frontier: readonly GraphNode[] = seeds;
	for (let hop = 1; hop <= depth + 1 && frontier.length > 0; hop++) {
		const next: GraphNode[] = [];
		for (const node of frontier) {
			for (const edge of index.incoming.get(node.id) ?? []) {
				const src = index.byId.get(edge.src);
				if (src === undefined || seen.has(src.id)) continue;
				const testish = isTestish(index, src);
				// Past the range only the tests of in-range nodes count.
				if (hop > depth && !src.test) continue;
				seen.add(src.id);
				if (src.test) {
					tests.push({ ...toRef(src), depth: hop });
					continue;
				}
				next.push(src);
				if (testish) continue;
				if (!isFileNode(src)) callers.push({ ...toRef(src), depth: hop });
				if (!seedPaths.has(src.path)) dependents.add(src.path);
			}
		}
		frontier = next;
	}

	const dependentList = [...dependents].sort();
	return {
		targets: named.map(toRef),
		unknown,
		callers: callers.sort((a, b) => a.depth - b.depth || byId(a, b)),
		dependents: dependentList,
		tests: [...dropCoveredTestFiles(tests)].sort(byId),
		blastScore: blastScore(index, seeds, dependentList),
	};
}

/**
 * What a change to `files` or `symbols` can affect: transitive callers up to
 * `depth` hops, the files they live in, the tests covering them, and a
 * blast score.
 */
export function impact(
	ports: GraphReadPorts,
	request: ImpactRequest,
): Result<ImpactReport, GraphStoreError> {
	const index = loadIndex(ports.db);
	if (!index.ok) return index;
	return { ok: true, value: impactOf(index.value, request) };
}
