/**
 * Data shapes of the incremental graph store (v1 task 5.2, FR-GRAPH-2) and
 * the codecs between them and `DbPort` rows. The tables themselves are
 * created by `db/graph-migrations.ts`.
 */

import type { DbRow } from "../../ports/db";
import type { Lang, ParsedFile, SymbolKind } from "../parse/types";

/** A file node, a parsed symbol, or a test the parser found outside any symbol. */
export type NodeKind = SymbolKind | "file" | "test" | "suite";

export type EdgeKind = "imports" | "calls" | "references" | "inherits";

export type GraphFile = Readonly<{
	/** Repo-relative, `/`-separated. */
	path: string;
	/** sha256 of the file content, hex. */
	hash: string;
	lang: Lang;
	isTest: boolean;
}>;

export type GraphNode = Readonly<{
	/**
	 * `path` for a file node, `path#qualifiedName` for anything inside it;
	 * a repeated qualified name in one file gets a `~2`, `~3` suffix in
	 * source order. Ids never depend on line numbers, so an edit that only
	 * moves code keeps every id stable.
	 */
	id: string;
	path: string;
	/** Source order within the file; the file node is 0. */
	ord: number;
	kind: NodeKind;
	name: string;
	qualifiedName: string;
	parent: string | null;
	exported: boolean;
	/** True for test cases and suites, and for symbols that are tests. */
	test: boolean;
	startLine: number;
	endLine: number;
}>;

export type GraphEdge = Readonly<{
	src: string;
	dst: string;
	kind: EdgeKind;
	/** The file whose resolution produced the edge: always `src`'s file. */
	path: string;
}>;

/**
 * What the store keeps of a parse: everything except the path-derived
 * fields, so one parse serves every path with the same content and grammar.
 */
export type StoredFacts = Omit<ParsedFile, "path" | "lang" | "isTestFile"> &
	Readonly<{ lineCount: number }>;

const str = (row: DbRow, key: string): string => String(row[key] ?? "");
const num = (row: DbRow, key: string): number => Number(row[key] ?? 0);
const bool = (row: DbRow, key: string): boolean => num(row, key) !== 0;

export function decodeFile(row: DbRow): GraphFile {
	return {
		path: str(row, "path"),
		hash: str(row, "hash"),
		lang: str(row, "lang") as Lang,
		isTest: bool(row, "is_test"),
	};
}

export function decodeNode(row: DbRow): GraphNode {
	const parent = row.parent;
	return {
		id: str(row, "id"),
		path: str(row, "path"),
		ord: num(row, "ord"),
		kind: str(row, "kind") as NodeKind,
		name: str(row, "name"),
		qualifiedName: str(row, "qualified_name"),
		parent: typeof parent === "string" ? parent : null,
		exported: bool(row, "exported"),
		test: bool(row, "test"),
		startLine: num(row, "start_line"),
		endLine: num(row, "end_line"),
	};
}

export function decodeEdge(row: DbRow): GraphEdge {
	return {
		src: str(row, "src"),
		dst: str(row, "dst"),
		kind: str(row, "kind") as EdgeKind,
		path: str(row, "path"),
	};
}

export const NODE_COLUMNS =
	"id, path, ord, kind, name, qualified_name, parent, exported, test, start_line, end_line";

export function encodeNode(
	node: GraphNode,
): readonly (string | number | null)[] {
	return [
		node.id,
		node.path,
		node.ord,
		node.kind,
		node.name,
		node.qualifiedName,
		node.parent,
		node.exported ? 1 : 0,
		node.test ? 1 : 0,
		node.startLine,
		node.endLine,
	];
}

export function encodeFacts(facts: StoredFacts): string {
	return JSON.stringify(facts);
}

/** Null when the stored JSON is unreadable; the caller treats that as a cache miss. */
export function decodeFacts(json: string): StoredFacts | null {
	try {
		const value: unknown = JSON.parse(json);
		return typeof value === "object" && value !== null && "symbols" in value
			? (value as StoredFacts)
			: null;
	} catch {
		return null;
	}
}
