import { getCacheDb } from "../db/index";

export interface CacheEntry {
	key: string;
	value: string;
	createdAt: number; // Unix timestamp ms
	ttl: number; // seconds, 0 = forever
	promptVersion?: string;
	contextHash?: string;
	model?: string;
}

export interface CacheStats {
	l1Hits: number;
	l2Hits: number;
	misses: number;
	totalQueries: number;
	entriesL1: number;
	entriesL2: number;
}

interface CacheSetOptions {
	ttl?: number;
	promptVersion?: string;
	contextHash?: string;
	model?: string;
}

/** Returns true when the entry has exceeded its TTL. */
function isExpired(entry: CacheEntry): boolean {
	if (entry.ttl <= 0) return false;
	return Date.now() - entry.createdAt > entry.ttl * 1000;
}

/** Raw row shape returned by SQLite queries. */
interface RawRow {
	key: string;
	value: string;
	created_at: string;
	ttl: number | null;
	prompt_version: string | null;
	context_hash: string | null;
	model: string | null;
}

function rowToEntry(row: RawRow): CacheEntry {
	return {
		key: row.key,
		value: row.value,
		createdAt: Number(row.created_at),
		ttl: row.ttl ?? 0,
		promptVersion: row.prompt_version ?? undefined,
		contextHash: row.context_hash ?? undefined,
		model: row.model ?? undefined,
	};
}

const L1_MAX = 100;

export interface CacheManager {
	get(key: string): CacheEntry | null;
	set(key: string, value: string, options?: CacheSetOptions): void;
	has(key: string): boolean;
	invalidate(key: string): void;
	clear(): void;
	stats(): CacheStats;
}

export function createCacheManager(mainaDir: string): CacheManager {
	// Initialise L2 (SQLite)
	const dbResult = getCacheDb(mainaDir);
	if (!dbResult.ok) {
		// Return a no-op manager that always misses — never throw
		const noop: CacheManager = {
			get: () => null,
			set: () => {
				/* no-op */
			},
			has: () => false,
			invalidate: () => {
				/* no-op */
			},
			clear: () => {
				/* no-op */
			},
			stats: () => ({
				l1Hits: 0,
				l2Hits: 0,
				misses: 0,
				totalQueries: 0,
				entriesL1: 0,
				entriesL2: 0,
			}),
		};
		return noop;
	}

	const { db } = dbResult.value;

	// Prepared statements
	const stmtGet = db.prepare<RawRow, [string]>(
		`SELECT key, value, created_at, ttl, prompt_version, context_hash, model
		 FROM cache_entries WHERE key = ?`,
	);
	const stmtInsert = db.prepare(
		`INSERT OR REPLACE INTO cache_entries
		 (id, key, value, created_at, ttl, prompt_version, context_hash, model)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const stmtDelete = db.prepare(`DELETE FROM cache_entries WHERE key = ?`);
	const stmtClear = db.prepare(`DELETE FROM cache_entries`);
	const stmtCount = db.prepare<{ cnt: number }, []>(
		`SELECT COUNT(*) as cnt FROM cache_entries`,
	);

	// L1 in-memory map (maintains insertion order for eviction)
	const l1 = new Map<string, CacheEntry>();

	// Stats counters
	let l1Hits = 0;
	let l2Hits = 0;
	let misses = 0;

	function evictIfNeeded(): void {
		if (l1.size >= L1_MAX) {
			// Delete the first (oldest) key
			const firstKey = l1.keys().next().value;
			if (firstKey !== undefined) {
				l1.delete(firstKey);
			}
		}
	}

	function get(key: string): CacheEntry | null {
		// Check L1
		const l1Entry = l1.get(key);
		if (l1Entry !== undefined) {
			if (isExpired(l1Entry)) {
				l1.delete(key);
				// Fall through to check L2 (it will also be expired, but be consistent)
			} else {
				l1Hits++;
				return l1Entry;
			}
		}

		// Check L2
		const row = stmtGet.get(key);
		if (row == null) {
			misses++;
			return null;
		}

		const entry = rowToEntry(row);
		if (isExpired(entry)) {
			misses++;
			return null;
		}

		// Promote to L1
		l2Hits++;
		evictIfNeeded();
		l1.set(key, entry);
		return entry;
	}

	function set(key: string, value: string, options?: CacheSetOptions): void {
		const now = Date.now();
		const ttl = options?.ttl ?? 0;
		const entry: CacheEntry = {
			key,
			value,
			createdAt: now,
			ttl,
			promptVersion: options?.promptVersion,
			contextHash: options?.contextHash,
			model: options?.model,
		};

		// Write to L2 first
		const id = `${key}-${now}`;
		stmtInsert.run(
			id,
			key,
			value,
			String(now),
			ttl,
			options?.promptVersion ?? null,
			options?.contextHash ?? null,
			options?.model ?? null,
		);

		// Write to L1 (evict oldest if needed)
		if (l1.has(key)) {
			// Update in-place without changing insertion order (delete + re-insert)
			l1.delete(key);
		} else {
			evictIfNeeded();
		}
		l1.set(key, entry);
	}

	function has(key: string): boolean {
		return get(key) !== null;
	}

	function invalidate(key: string): void {
		l1.delete(key);
		stmtDelete.run(key);
	}

	function clear(): void {
		l1.clear();
		stmtClear.run();
	}

	function stats(): CacheStats {
		const countRow = stmtCount.get();
		const entriesL2 = countRow?.cnt ?? 0;
		return {
			l1Hits,
			l2Hits,
			misses,
			totalQueries: l1Hits + l2Hits + misses,
			entriesL1: l1.size,
			entriesL2,
		};
	}

	return { get, set, has, invalidate, clear, stats };
}
