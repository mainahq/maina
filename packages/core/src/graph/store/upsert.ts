/**
 * Writes one file's rows: its `graph_files` row, its cached parse and its
 * nodes. Edges are written separately by resolution, after every changed
 * file's nodes are in place, because an edge can point into any file.
 */

import type { Result } from "../../db/index";
import type { DbError, DbPort, DbValue } from "../../ports/db";
import type { Lang } from "../parse/types";
import {
	encodeFacts,
	encodeNode,
	type GraphNode,
	NODE_COLUMNS,
	type StoredFacts,
} from "./schema";

const baseName = (path: string): string => path.split("/").at(-1) ?? path;

/** Gives a repeated id a `~n` suffix, in order of appearance. */
function uniqueIds(ids: readonly string[]): readonly string[] {
	const seen = new Map<string, number>();
	return ids.map((id) => {
		const count = (seen.get(id) ?? 0) + 1;
		seen.set(id, count);
		return count === 1 ? id : `${id}~${count}`;
	});
}

/**
 * The nodes of one file, in source order: the file itself, then its symbols,
 * then the tests that are not already symbols (JS/TS `describe`/`test`
 * blocks). Pure: the same path and facts always give the same nodes.
 */
export function nodesOf(
	path: string,
	isTest: boolean,
	facts: StoredFacts,
): readonly GraphNode[] {
	const testNames = new Set(facts.tests.map((t) => t.qualifiedName));
	const symbolNames = new Set(facts.symbols.map((s) => s.qualifiedName));
	const looseTests = facts.tests.filter(
		(t) => !symbolNames.has(t.qualifiedName),
	);
	const ids = uniqueIds([
		...facts.symbols.map((s) => `${path}#${s.qualifiedName}`),
		...looseTests.map((t) => `${path}#${t.qualifiedName}`),
	]);
	const file: GraphNode = {
		id: path,
		path,
		ord: 0,
		kind: "file",
		name: baseName(path),
		qualifiedName: path,
		parent: null,
		exported: true,
		test: isTest,
		startLine: 1,
		endLine: facts.lineCount,
	};
	const symbols = facts.symbols.map(
		(s, i): GraphNode => ({
			id: ids[i] ?? "",
			path,
			ord: i + 1,
			kind: s.kind,
			name: s.name,
			qualifiedName: s.qualifiedName,
			parent: s.parent,
			exported: s.exported,
			test: testNames.has(s.qualifiedName),
			startLine: s.span.startLine,
			endLine: s.span.endLine,
		}),
	);
	const offset = facts.symbols.length;
	const tests = looseTests.map(
		(t, i): GraphNode => ({
			id: ids[offset + i] ?? "",
			path,
			ord: offset + i + 1,
			kind: t.kind === "suite" ? "suite" : "test",
			name: t.name,
			qualifiedName: t.qualifiedName,
			parent: t.scope,
			exported: false,
			test: true,
			startLine: t.span.startLine,
			endLine: t.span.endLine,
		}),
	);
	return [file, ...symbols, ...tests];
}

/** Runs statements in order and stops at the first failure. */
export function runAll(
	db: DbPort,
	statements: readonly (readonly [string, readonly DbValue[]])[],
): Result<void, DbError> {
	for (const [sql, params] of statements) {
		const done = db.run(sql, params);
		if (!done.ok) return done;
	}
	return { ok: true, value: undefined };
}

/** Removes every row a file owns. Its incoming edges go when their owners re-resolve. */
export function deleteFile(db: DbPort, path: string): Result<void, DbError> {
	return runAll(db, [
		["DELETE FROM graph_files WHERE path = ?", [path]],
		["DELETE FROM graph_nodes WHERE path = ?", [path]],
		["DELETE FROM graph_edges WHERE path = ?", [path]],
		["DELETE FROM graph_deps WHERE path = ?", [path]],
	]);
}

export type FileUpsert = Readonly<{
	path: string;
	hash: string;
	lang: Lang;
	isTest: boolean;
	facts: StoredFacts;
}>;

/** Replaces a file's row, cached parse and nodes. */
export function upsertFile(
	db: DbPort,
	file: FileUpsert,
): Result<void, DbError> {
	const cleared = deleteFile(db, file.path);
	if (!cleared.ok) return cleared;
	const placeholders = NODE_COLUMNS.split(",")
		.map(() => "?")
		.join(", ");
	return runAll(db, [
		[
			"INSERT INTO graph_files (path, hash, lang, is_test) VALUES (?, ?, ?, ?)",
			[file.path, file.hash, file.lang, file.isTest ? 1 : 0],
		],
		[
			"INSERT OR REPLACE INTO graph_blobs (hash, lang, facts) VALUES (?, ?, ?)",
			[file.hash, file.lang, encodeFacts(file.facts)],
		],
		...nodesOf(file.path, file.isTest, file.facts).map(
			(node) =>
				[
					`INSERT INTO graph_nodes (${NODE_COLUMNS}) VALUES (${placeholders})`,
					encodeNode(node),
				] as const,
		),
	]);
}
