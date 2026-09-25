import { expect } from "bun:test";
import type { Result } from "../../../db/index";
import type { DbPort, DbRow, FsPort } from "../../../ports/index";
import {
	createFakeGit,
	createMemoryDb,
	createMemoryFs,
} from "../../../ports/testing";
import { parseFile } from "../../parse/index";
import type { Lang, ParsedFile, ParseError } from "../../parse/types";
import type { GraphSnapshot, GraphStorePorts } from "../index";
import { readGraph } from "../index";

export const ROOT = "/repo";

/** A mutable in-memory repo: an fs port plus a helper to edit it. */
type TestRepo = Readonly<{
	ports: GraphStorePorts;
	fs: FsPort;
	db: DbPort;
	write: (path: string, content: string) => Promise<void>;
	remove: (path: string) => Promise<void>;
}>;

export function createRepo(
	files: Readonly<Record<string, string>>,
	gitResponses: Readonly<Record<string, string>> = {},
): TestRepo {
	const fs = createMemoryFs(
		Object.fromEntries(
			Object.entries(files).map(([path, content]) => [
				`${ROOT}/${path}`,
				content,
			]),
		),
	);
	const db = createMemoryDb();
	return {
		ports: { fs, db, git: createFakeGit(gitResponses) },
		fs,
		db,
		write: async (path, content) => {
			await fs.writeFile(`${ROOT}/${path}`, content);
		},
		remove: async (path) => {
			await fs.remove(`${ROOT}/${path}`);
		},
	};
}

type ParseSpy = Readonly<{
	parse: (
		path: string,
		content: string,
		lang?: Lang,
	) => Promise<Result<ParsedFile, ParseError>>;
	calls: () => readonly string[];
	reset: () => void;
}>;

/** The real parser, recording which paths it was asked to parse. */
export function parseSpy(): ParseSpy {
	let calls: string[] = [];
	return {
		parse: (path, content, lang) => {
			calls.push(path);
			return parseFile(path, content, lang);
		},
		calls: () => [...calls].sort(),
		reset: () => {
			calls = [];
		},
	};
}

export function unwrap<T, E>(result: Result<T, E>): T {
	if (!result.ok) {
		expect(result.error).toBeUndefined();
		throw new Error("unreachable");
	}
	return result.value;
}

export function snapshot(db: DbPort): GraphSnapshot {
	return unwrap(readGraph(db));
}

/** `src -kind-> dst`, sorted: compact and order-independent. */
export function edgeRows(graph: GraphSnapshot): readonly string[] {
	return graph.edges.map((e) => `${e.src} -${e.kind}-> ${e.dst}`).sort();
}

export function nodeIds(graph: GraphSnapshot): readonly string[] {
	return graph.nodes.map((n) => n.id).sort();
}

const GRAPH_TABLES = [
	"graph_files",
	"graph_blobs",
	"graph_nodes",
	"graph_edges",
	"graph_deps",
] as const;

/** Every row of every graph table, in a canonical order. */
export function dumpTables(
	db: DbPort,
): Readonly<Record<string, readonly DbRow[]>> {
	return Object.fromEntries(
		GRAPH_TABLES.map((table) => {
			const rows = unwrap(db.all(`SELECT * FROM ${table}`));
			const sorted = [...rows]
				.map((row) => JSON.stringify(row))
				.sort()
				.map((row) => JSON.parse(row) as DbRow);
			return [table, sorted];
		}),
	);
}
