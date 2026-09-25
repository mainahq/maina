/**
 * Schema migrations for the incremental code-graph store (v1 task 5.2,
 * FR-GRAPH-2). The store talks to SQLite only through `DbPort`, so its
 * tables are created here with plain SQL rather than in `createXTables`.
 *
 * Migrations are append-only: never edit a shipped step, add a new one. The
 * applied version lives in `graph_meta`, so the graph tables can share a
 * database file with other stores without touching `PRAGMA user_version`.
 */

import type { DbError, DbPort } from "../ports/db";
import type { Result } from "./index";

type Migration = Readonly<{ version: number; statements: readonly string[] }>;

const GRAPH_MIGRATIONS: readonly Migration[] = [
	{
		version: 1,
		statements: [
			// One row per indexed source file, keyed by repo-relative posix path.
			`CREATE TABLE graph_files (
				path TEXT PRIMARY KEY,
				hash TEXT NOT NULL,
				lang TEXT NOT NULL,
				is_test INTEGER NOT NULL
			)`,
			"CREATE INDEX idx_graph_files_hash ON graph_files(hash)",
			// Parser output keyed by content hash, so identical content (a
			// rename, a revert, a copy) is never parsed twice.
			`CREATE TABLE graph_blobs (
				hash TEXT NOT NULL,
				lang TEXT NOT NULL,
				facts TEXT NOT NULL,
				PRIMARY KEY (hash, lang)
			) WITHOUT ROWID`,
			`CREATE TABLE graph_nodes (
				id TEXT PRIMARY KEY,
				path TEXT NOT NULL,
				ord INTEGER NOT NULL,
				kind TEXT NOT NULL,
				name TEXT NOT NULL,
				qualified_name TEXT NOT NULL,
				parent TEXT,
				exported INTEGER NOT NULL,
				test INTEGER NOT NULL,
				start_line INTEGER NOT NULL,
				end_line INTEGER NOT NULL
			)`,
			"CREATE INDEX idx_graph_nodes_path ON graph_nodes(path, ord)",
			"CREATE INDEX idx_graph_nodes_name ON graph_nodes(name)",
			// `path` is the file whose resolution produced the edge (the
			// source's file), so re-resolving a file replaces exactly its edges.
			`CREATE TABLE graph_edges (
				src TEXT NOT NULL,
				dst TEXT NOT NULL,
				kind TEXT NOT NULL,
				path TEXT NOT NULL,
				PRIMARY KEY (src, dst, kind)
			) WITHOUT ROWID`,
			"CREATE INDEX idx_graph_edges_dst ON graph_edges(dst)",
			"CREATE INDEX idx_graph_edges_path ON graph_edges(path)",
			// Every lookup a file's resolution made (a path, a directory
			// listing, a basename). A change to any key re-resolves `path`.
			`CREATE TABLE graph_deps (
				key TEXT NOT NULL,
				path TEXT NOT NULL,
				PRIMARY KEY (key, path)
			) WITHOUT ROWID`,
			"CREATE INDEX idx_graph_deps_path ON graph_deps(path)",
		],
	},
];

/** The schema version the current code expects. */
export const GRAPH_SCHEMA_VERSION = GRAPH_MIGRATIONS.at(-1)?.version ?? 0;

function currentVersion(db: DbPort): Result<number, DbError> {
	const created = db.run(
		"CREATE TABLE IF NOT EXISTS graph_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
	);
	if (!created.ok) return created;
	const rows = db.all(
		"SELECT value FROM graph_meta WHERE key = 'schema_version'",
	);
	if (!rows.ok) return rows;
	const value = rows.value[0]?.value;
	return { ok: true, value: typeof value === "string" ? Number(value) : 0 };
}

/**
 * Brings the graph tables up to `GRAPH_SCHEMA_VERSION`. Idempotent and cheap
 * when already current (one read). Each step runs in its own transaction, so
 * a failure leaves the store at the last complete version.
 */
export function migrateGraphStore(db: DbPort): Result<void, DbError> {
	const version = currentVersion(db);
	if (!version.ok) return version;
	for (const step of GRAPH_MIGRATIONS) {
		if (step.version <= version.value) continue;
		const began = db.run("BEGIN IMMEDIATE");
		if (!began.ok) return began;
		for (const sql of [
			...step.statements,
			`INSERT OR REPLACE INTO graph_meta (key, value) VALUES ('schema_version', '${step.version}')`,
		]) {
			const applied = db.run(sql);
			if (!applied.ok) {
				db.run("ROLLBACK");
				return applied;
			}
		}
		const committed = db.run("COMMIT");
		if (!committed.ok) return committed;
	}
	return { ok: true, value: undefined };
}
