/**
 * The sync behind `indexRepo` and `updateFiles`; see `index.ts` for the two
 * phases and the guarantee they give.
 */

import { createHash } from "node:crypto";
import { posix } from "node:path";
import { migrateGraphStore } from "../../db/graph-migrations";
import type { Result } from "../../db/index";
import type { DbError, DbPort, DbValue } from "../../ports/index";
import { parseFile } from "../parse/index";
import { detectLang, isTestPath } from "../parse/languages";
import type { Lang, ParsedFile } from "../parse/types";
import { baseName, dirOf, type GraphView } from "./modules";
import { changeKeys, resolveFile } from "./resolve";
import {
	decodeFacts,
	decodeNode,
	type GraphNode,
	type StoredFacts,
} from "./schema";
import type {
	GraphStoreError,
	GraphStoreOptions,
	GraphStorePorts,
	GraphSyncReport,
	ParseFn,
} from "./types";
import { deleteFile, type FileUpsert, runAll, upsertFile } from "./upsert";

type StoredRow = Readonly<{ hash: string; lang: string }>;

type Plan = Readonly<{
	upserts: readonly FileUpsert[];
	removed: readonly string[];
	parsed: readonly string[];
	reused: readonly string[];
	unchanged: readonly string[];
}>;

export const dbError = (e: DbError): GraphStoreError => ({
	kind: "db",
	message: e.message,
});

const hashOf = (content: string): string =>
	createHash("sha256").update(content).digest("hex");

/** Lines as an editor shows them: a trailing newline does not start a new line. */
const lineCount = (content: string): number =>
	Math.max(1, content.split("\n").length - (content.endsWith("\n") ? 1 : 0));

function toFacts(parsed: ParsedFile, content: string): StoredFacts {
	const { path: _path, lang: _lang, isTestFile: _isTest, ...facts } = parsed;
	return { ...facts, lineCount: lineCount(content) };
}

function emptyFacts(content: string): StoredFacts {
	return {
		symbols: [],
		imports: [],
		calls: [],
		refs: [],
		tests: [],
		errors: [],
		lineCount: lineCount(content),
	};
}

function loadStored(
	db: DbPort,
): Result<ReadonlyMap<string, StoredRow>, DbError> {
	const rows = db.all("SELECT path, hash, lang FROM graph_files");
	if (!rows.ok) return rows;
	return {
		ok: true,
		value: new Map(
			rows.value.map((r) => [
				String(r.path),
				{ hash: String(r.hash), lang: String(r.lang) },
			]),
		),
	};
}

function cachedFacts(
	db: DbPort,
	hash: string,
	lang: Lang,
): Result<StoredFacts | null, DbError> {
	const rows = db.all(
		"SELECT facts FROM graph_blobs WHERE hash = ? AND lang = ?",
		[hash, lang],
	);
	if (!rows.ok) return rows;
	const json = rows.value[0]?.facts;
	return {
		ok: true,
		value: typeof json === "string" ? decodeFacts(json) : null,
	};
}

type Candidate =
	| Readonly<{ kind: "skip" }>
	| Readonly<{ kind: "unchanged"; path: string }>
	| Readonly<{ kind: "removed"; path: string }>
	| Readonly<{ kind: "upsert"; file: FileUpsert; source: "parsed" | "reused" }>;

async function examine(
	ports: GraphStorePorts,
	root: string,
	path: string,
	stored: ReadonlyMap<string, StoredRow>,
	parse: ParseFn,
): Promise<Result<Candidate, GraphStoreError>> {
	const lang = detectLang(path);
	const previous = stored.get(path);
	if (lang === null) return { ok: true, value: { kind: "skip" } };
	const read = await ports.fs.readFile(posix.join(root, path));
	if (!read.ok) {
		if (read.error.kind === "not_found") {
			return {
				ok: true,
				value: previous ? { kind: "removed", path } : { kind: "skip" },
			};
		}
		return {
			ok: false,
			error: { kind: "fs", path, message: read.error.message },
		};
	}
	const content = read.value;
	const hash = hashOf(content);
	if (previous?.hash === hash && previous.lang === lang) {
		return { ok: true, value: { kind: "unchanged", path } };
	}
	const isTest = isTestPath(path, lang);
	const cached = cachedFacts(ports.db, hash, lang);
	if (!cached.ok) return { ok: false, error: dbError(cached.error) };
	if (cached.value !== null) {
		return {
			ok: true,
			value: {
				kind: "upsert",
				source: "reused",
				file: { path, hash, lang, isTest, facts: cached.value },
			},
		};
	}
	const parsed = await parse(path, content, lang);
	if (!parsed.ok && parsed.error.kind === "grammar_load_failed") {
		return { ok: false, error: { kind: "parse", error: parsed.error } };
	}
	// A file the parser cannot read stays in the store with no symbols, so it
	// is still tracked and is retried when its content changes.
	const facts = parsed.ok
		? toFacts(parsed.value, content)
		: emptyFacts(content);
	return {
		ok: true,
		value: {
			kind: "upsert",
			source: "parsed",
			file: { path, hash, lang, isTest, facts },
		},
	};
}

const BATCH = 32;

/** Which paths a sync looks at. */
type Scope = Readonly<{
	/** Read and hashed: stored if present, removed if gone. */
	examine: readonly string[];
	/** Stored paths to remove without reading them (outside a full index). */
	drop: readonly string[];
}>;

/** Phase 1: decide what changed. Reads files; writes nothing. */
async function plan(
	ports: GraphStorePorts,
	root: string,
	scope: Scope,
	stored: ReadonlyMap<string, StoredRow>,
	parse: ParseFn,
): Promise<Result<Plan, GraphStoreError>> {
	const { examine: candidates, drop } = scope;
	const upserts: FileUpsert[] = [];
	const removed: string[] = drop.filter((p) => stored.has(p));
	const parsed: string[] = [];
	const reused: string[] = [];
	const unchanged: string[] = [];
	for (let i = 0; i < candidates.length; i += BATCH) {
		const batch = candidates.slice(i, i + BATCH);
		const results = await Promise.all(
			batch.map((p) => examine(ports, root, p, stored, parse)),
		);
		for (const result of results) {
			if (!result.ok) return result;
			const c = result.value;
			switch (c.kind) {
				case "skip":
					break;
				case "unchanged":
					unchanged.push(c.path);
					break;
				case "removed":
					removed.push(c.path);
					break;
				case "upsert":
					upserts.push(c.file);
					(c.source === "parsed" ? parsed : reused).push(c.file.path);
					break;
				default: {
					const unreachable: never = c;
					return unreachable;
				}
			}
		}
	}
	return { ok: true, value: { upserts, removed, parsed, reused, unchanged } };
}

/** A view over the store as it stands inside the sync transaction. */
function storeView(
	db: DbPort,
	paths: readonly string[],
): Readonly<{ view: GraphView; failure: () => DbError | null }> {
	const known = new Set(paths);
	// `paths` arrives sorted, so each group below is built in sorted order.
	const group = (keyOf: (item: string) => string, items: Iterable<string>) => {
		const groups = new Map<string, string[]>();
		for (const item of items) {
			const key = keyOf(item);
			const members = groups.get(key);
			if (members === undefined) groups.set(key, [item]);
			else members.push(item);
		}
		return groups;
	};
	const byDir = group(dirOf, paths);
	const byBase = group(baseName, paths);
	const byDirName = group(baseName, [...byDir.keys()].sort());
	const nodes = new Map<string, readonly GraphNode[]>();
	let failure: DbError | null = null;
	return {
		view: {
			has: (path) => known.has(path),
			filesIn: (dir) => byDir.get(dir) ?? [],
			dirsNamed: (name) => byDirName.get(name) ?? [],
			withBase: (base) => byBase.get(base) ?? [],
			nodesIn: (path) => {
				const hit = nodes.get(path);
				if (hit !== undefined) return hit;
				const rows = db.all(
					"SELECT * FROM graph_nodes WHERE path = ? ORDER BY ord",
					[path],
				);
				if (!rows.ok) {
					failure ??= rows.error;
					return [];
				}
				const decoded = rows.value.map(decodeNode);
				nodes.set(path, decoded);
				return decoded;
			},
		},
		failure: () => failure,
	};
}

/** Files whose recorded lookups a change to any of `changed` can affect. */
function dependentsOf(
	db: DbPort,
	changed: readonly string[],
): Result<readonly string[], DbError> {
	const keys = [...new Set(changed.flatMap(changeKeys))];
	const found = new Set<string>();
	for (let i = 0; i < keys.length; i += 500) {
		const chunk = keys.slice(i, i + 500);
		const rows = db.all(
			`SELECT DISTINCT path FROM graph_deps WHERE key IN (${chunk.map(() => "?").join(", ")})`,
			chunk,
		);
		if (!rows.ok) return rows;
		for (const row of rows.value) found.add(String(row.path));
	}
	return { ok: true, value: [...found] };
}

function storedFactsOf(
	db: DbPort,
	path: string,
): Result<Readonly<{ lang: Lang; facts: StoredFacts }> | null, DbError> {
	const rows = db.all(
		`SELECT f.lang AS lang, b.facts AS facts FROM graph_files f
		 LEFT JOIN graph_blobs b ON b.hash = f.hash AND b.lang = f.lang
		 WHERE f.path = ?`,
		[path],
	);
	if (!rows.ok) return rows;
	const row = rows.value[0];
	if (row === undefined) return { ok: true, value: null };
	const facts = typeof row.facts === "string" ? decodeFacts(row.facts) : null;
	return {
		ok: true,
		value: { lang: String(row.lang) as Lang, facts: facts ?? emptyFacts("") },
	};
}

/** Phase 2 body: runs inside the transaction; returns the re-resolved paths. */
function apply(db: DbPort, change: Plan): Result<readonly string[], DbError> {
	const touched = [...change.removed, ...change.upserts.map((u) => u.path)];
	const dependents = dependentsOf(db, touched);
	if (!dependents.ok) return dependents;

	for (const path of change.removed) {
		const done = deleteFile(db, path);
		if (!done.ok) return done;
	}
	for (const file of change.upserts) {
		const done = upsertFile(db, file);
		if (!done.ok) return done;
	}

	const pathRows = db.all("SELECT path FROM graph_files ORDER BY path");
	if (!pathRows.ok) return pathRows;
	const paths = pathRows.value.map((r) => String(r.path));
	const known = new Set(paths);
	const { view, failure } = storeView(db, paths);

	const upserted = new Map(change.upserts.map((u) => [u.path, u]));
	const toResolve = [...new Set([...upserted.keys(), ...dependents.value])]
		.filter((p) => known.has(p))
		.sort();
	for (const path of toResolve) {
		const own = upserted.get(path);
		const stored = own
			? { ok: true as const, value: own }
			: storedFactsOf(db, path);
		if (!stored.ok) return stored;
		if (stored.value === null) continue;
		const nodes = view.nodesIn(path);
		const { edges, deps } = resolveFile(
			path,
			stored.value.lang,
			stored.value.facts,
			nodes,
			view,
		);
		const failed = failure();
		if (failed !== null) return { ok: false, error: failed };
		const written = runAll(db, [
			["DELETE FROM graph_edges WHERE path = ?", [path]],
			["DELETE FROM graph_deps WHERE path = ?", [path]],
			...edges.map(
				(e) =>
					[
						"INSERT OR IGNORE INTO graph_edges (src, dst, kind, path) VALUES (?, ?, ?, ?)",
						[e.src, e.dst, e.kind, e.path] as readonly DbValue[],
					] as const,
			),
			...deps.map(
				(key) =>
					[
						"INSERT INTO graph_deps (key, path) VALUES (?, ?)",
						[key, path] as readonly DbValue[],
					] as const,
			),
		]);
		if (!written.ok) return written;
	}

	const pruned = db.run(
		`DELETE FROM graph_blobs WHERE NOT EXISTS (
			SELECT 1 FROM graph_files f WHERE f.hash = graph_blobs.hash AND f.lang = graph_blobs.lang
		)`,
	);
	if (!pruned.ok) return pruned;
	return { ok: true, value: toResolve };
}

function inTransaction<T>(
	db: DbPort,
	body: () => Result<T, DbError>,
): Result<T, DbError> {
	const began = db.run("BEGIN IMMEDIATE");
	if (!began.ok) return began;
	const result = body();
	if (!result.ok) {
		db.run("ROLLBACK");
		return result;
	}
	const committed = db.run("COMMIT");
	if (!committed.ok) {
		db.run("ROLLBACK");
		return committed;
	}
	return result;
}

export async function sync(
	ports: GraphStorePorts,
	root: string,
	/** Given the stored paths, the paths to examine and to drop. */
	scopeOf: (storedPaths: readonly string[]) => Scope,
	options: GraphStoreOptions,
): Promise<Result<GraphSyncReport, GraphStoreError>> {
	const migrated = migrateGraphStore(ports.db);
	if (!migrated.ok) return { ok: false, error: dbError(migrated.error) };
	const stored = loadStored(ports.db);
	if (!stored.ok) return { ok: false, error: dbError(stored.error) };

	const planned = await plan(
		ports,
		root,
		scopeOf([...stored.value.keys()]),
		stored.value,
		options.parse ?? parseFile,
	);
	if (!planned.ok) return planned;
	const change = planned.value;

	let resolved: readonly string[] = [];
	if (change.upserts.length > 0 || change.removed.length > 0) {
		const applied = inTransaction(ports.db, () => apply(ports.db, change));
		if (!applied.ok) return { ok: false, error: dbError(applied.error) };
		resolved = applied.value;
	}
	const sorted = (xs: readonly string[]): readonly string[] => [...xs].sort();
	return {
		ok: true,
		value: {
			parsed: sorted(change.parsed),
			reused: sorted(change.reused),
			unchanged: sorted(change.unchanged),
			removed: sorted(change.removed),
			resolved,
		},
	};
}
