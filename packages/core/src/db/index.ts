import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type DbHandle = {
	db: Database;
	drizzle: ReturnType<typeof drizzle<typeof schema>>;
};

export type Result<T, E = string> =
	| { ok: true; value: T }
	| { ok: false; error: E };

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

/**
 * Create all tables defined in the schema using raw SQL.
 * Uses CREATE TABLE IF NOT EXISTS so this is safe to call repeatedly.
 */
function createTables(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS episodic_entries (
			id TEXT PRIMARY KEY,
			content TEXT NOT NULL,
			summary TEXT,
			relevance REAL,
			access_count INTEGER,
			created_at TEXT NOT NULL,
			last_accessed_at TEXT,
			type TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS semantic_entities (
			id TEXT PRIMARY KEY,
			file_path TEXT NOT NULL,
			name TEXT NOT NULL,
			kind TEXT NOT NULL,
			start_line INTEGER NOT NULL,
			end_line INTEGER NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS dependency_edges (
			id TEXT PRIMARY KEY,
			source_file TEXT NOT NULL,
			target_file TEXT NOT NULL,
			weight REAL,
			type TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS cache_entries (
			id TEXT PRIMARY KEY,
			key TEXT NOT NULL UNIQUE,
			value TEXT NOT NULL,
			prompt_version TEXT,
			context_hash TEXT,
			model TEXT,
			created_at TEXT NOT NULL,
			ttl INTEGER
		);

		CREATE TABLE IF NOT EXISTS feedback (
			id TEXT PRIMARY KEY,
			prompt_hash TEXT NOT NULL,
			command TEXT NOT NULL,
			accepted INTEGER NOT NULL,
			context TEXT,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS prompt_versions (
			id TEXT PRIMARY KEY,
			task TEXT NOT NULL,
			hash TEXT NOT NULL,
			content TEXT NOT NULL,
			version INTEGER NOT NULL,
			accept_rate REAL,
			usage_count INTEGER,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS commit_snapshots (
			id TEXT PRIMARY KEY,
			timestamp TEXT NOT NULL,
			branch TEXT NOT NULL,
			commit_hash TEXT NOT NULL,
			verify_duration_ms INTEGER NOT NULL,
			total_duration_ms INTEGER NOT NULL,
			context_tokens INTEGER NOT NULL,
			context_budget INTEGER NOT NULL,
			context_utilization REAL NOT NULL,
			cache_hits INTEGER NOT NULL,
			cache_misses INTEGER NOT NULL,
			findings_total INTEGER NOT NULL,
			findings_errors INTEGER NOT NULL,
			findings_warnings INTEGER NOT NULL,
			tools_run INTEGER NOT NULL,
			syntax_passed INTEGER NOT NULL,
			pipeline_passed INTEGER NOT NULL
		);
	`);
}

/**
 * Initialise a SQLite database at the given path, creating parent directories as needed.
 * Returns a Result containing the raw Database and the Drizzle ORM instance.
 * Never throws — all errors are returned as Err values.
 */
export function initDatabase(dbPath: string): Result<DbHandle> {
	try {
		mkdirSync(dirname(dbPath), { recursive: true });
		const db = new Database(dbPath, { create: true });
		db.exec("PRAGMA journal_mode=WAL;");
		createTables(db);
		const orm = drizzle(db, { schema });
		return ok({ db, drizzle: orm });
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

/**
 * Open the context database (.maina/context/index.db).
 * Contains: episodic_entries, semantic_entities, dependency_edges.
 */
export function getContextDb(mainaDir: string): Result<DbHandle> {
	return initDatabase(join(mainaDir, "context", "index.db"));
}

/**
 * Open the cache database (.maina/cache/cache.db).
 * Contains: cache_entries.
 */
export function getCacheDb(mainaDir: string): Result<DbHandle> {
	return initDatabase(join(mainaDir, "cache", "cache.db"));
}

/**
 * Open the feedback database (.maina/feedback.db).
 * Contains: feedback, prompt_versions.
 */
export function getFeedbackDb(mainaDir: string): Result<DbHandle> {
	return initDatabase(join(mainaDir, "feedback.db"));
}

/**
 * Open the stats database (.maina/stats.db).
 * Contains: commit_snapshots.
 */
export function getStatsDb(mainaDir: string): Result<DbHandle> {
	return initDatabase(join(mainaDir, "stats.db"));
}
