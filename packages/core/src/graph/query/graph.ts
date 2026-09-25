/**
 * In-memory lookups over a stored graph snapshot, shared by the queries.
 * Loading is the only effect; everything else here is pure.
 */

import type { Result } from "../../db/index";
import type { DbPort } from "../../ports/index";
import { readGraph } from "../store/index";
import type { GraphEdge, GraphFile, GraphNode } from "../store/schema";
import type { GraphStoreError } from "../store/types";
import type { NodeRef } from "./types";

export type GraphIndex = Readonly<{
	nodes: readonly GraphNode[];
	byId: ReadonlyMap<string, GraphNode>;
	byPath: ReadonlyMap<string, readonly GraphNode[]>;
	files: ReadonlyMap<string, GraphFile>;
	/** Edges by `dst`, excluding nothing; callers filter by kind. */
	incoming: ReadonlyMap<string, readonly GraphEdge[]>;
	/** Edges by `src`. */
	outgoing: ReadonlyMap<string, readonly GraphEdge[]>;
}>;

function group<T>(
	items: readonly T[],
	key: (item: T) => string,
): ReadonlyMap<string, readonly T[]> {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = map.get(k);
		if (list === undefined) map.set(k, [item]);
		else list.push(item);
	}
	return map;
}

export function loadIndex(db: DbPort): Result<GraphIndex, GraphStoreError> {
	const graph = readGraph(db);
	if (!graph.ok) return graph;
	const { nodes, edges, files } = graph.value;
	return {
		ok: true,
		value: {
			nodes,
			byId: new Map(nodes.map((n) => [n.id, n])),
			byPath: group(nodes, (n) => n.path),
			files: new Map(files.map((f) => [f.path, f])),
			incoming: group(edges, (e) => e.dst),
			outgoing: group(edges, (e) => e.src),
		},
	};
}

/** Orders by id, by code unit (not locale), so results are stable everywhere. */
export const byId = (a: { id: string }, b: { id: string }): number =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const isFileNode = (n: GraphNode): boolean => n.kind === "file";

/** A test case or suite, a symbol that is a test, or anything in a test file. */
export function isTestish(index: GraphIndex, n: GraphNode): boolean {
	return n.test || index.files.get(n.path)?.isTest === true;
}

export function toRef(n: GraphNode): NodeRef {
	return {
		id: n.id,
		path: n.path,
		name: n.name,
		qualifiedName: n.qualifiedName,
		kind: n.kind,
		startLine: n.startLine,
		endLine: n.endLine,
	};
}

/** `./src\\a.ts` -> `src/a.ts`. */
export const normalizePath = (path: string): string =>
	path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");

/** A node plus every member nested under it in the same file. */
export function withMembers(
	index: GraphIndex,
	node: GraphNode,
): readonly GraphNode[] {
	if (isFileNode(node)) return [node];
	const inFile = index.byPath.get(node.path) ?? [];
	const out: GraphNode[] = [node];
	const owners = new Set([node.qualifiedName]);
	// Nodes are in source order, so a member always follows its owner.
	for (const n of inFile) {
		if (n.parent !== null && owners.has(n.parent) && !isFileNode(n)) {
			out.push(n);
			owners.add(n.qualifiedName);
		}
	}
	return out;
}

/**
 * The nodes a symbol reference names: an exact id, else every non-test
 * symbol with that qualified name.
 */
export function lookupSymbol(
	index: GraphIndex,
	symbol: string,
): readonly GraphNode[] {
	const exact = index.byId.get(symbol);
	if (exact !== undefined) return [exact];
	return index.nodes.filter(
		(n) => !isFileNode(n) && !isTestish(index, n) && n.qualifiedName === symbol,
	);
}
