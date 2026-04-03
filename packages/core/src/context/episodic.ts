import { join } from "node:path";
import { initDatabase } from "../db/index.ts";

export interface EpisodicEntry {
	id: string;
	content: string;
	summary: string;
	relevance: number;
	accessCount: number;
	createdAt: string; // ISO timestamp
	lastAccessedAt: string; // ISO timestamp
	type: string; // "review" | "session" | "commit" | "feedback"
}

// Raw row shape returned from SQLite
interface EpisodicRow {
	id: string;
	content: string;
	summary: string | null;
	relevance: number | null;
	access_count: number | null;
	created_at: string;
	last_accessed_at: string | null;
	type: string;
}

function rowToEntry(row: EpisodicRow): EpisodicEntry {
	return {
		id: row.id,
		content: row.content,
		summary: row.summary ?? "",
		relevance: row.relevance ?? 1.0,
		accessCount: row.access_count ?? 0,
		createdAt: row.created_at,
		lastAccessedAt: row.last_accessed_at ?? row.created_at,
		type: row.type,
	};
}

/**
 * Opens (or creates) the context database for the given mainaDir.
 * Returns the raw bun:sqlite Database instance.
 * Never throws — returns null on failure.
 */
function openDb(mainaDir: string) {
	const dbPath = join(mainaDir, "context", "index.db");
	const result = initDatabase(dbPath);
	if (!result.ok) return null;
	return result.value.db;
}

/**
 * Implements the Ebbinghaus forgetting curve for relevance decay.
 * Formula: exp(-0.1 * daysSinceAccess) + 0.1 * min(accessCount, 5)
 * Clamped to [0, 1].
 */
export function calculateDecay(
	daysSinceAccess: number,
	accessCount: number,
): number {
	const raw = Math.exp(-0.1 * daysSinceAccess) + 0.1 * Math.min(accessCount, 5);
	return Math.min(1, Math.max(0, raw));
}

/**
 * Adds a new episodic entry to the database.
 * Sets id (crypto.randomUUID), relevance=1.0, accessCount=0, timestamps=now.
 */
export function addEntry(
	mainaDir: string,
	entry: Omit<
		EpisodicEntry,
		"id" | "relevance" | "accessCount" | "createdAt" | "lastAccessedAt"
	>,
): EpisodicEntry {
	const db = openDb(mainaDir);
	const now = new Date().toISOString();
	const id = crypto.randomUUID();

	const newEntry: EpisodicEntry = {
		id,
		content: entry.content,
		summary: entry.summary,
		type: entry.type,
		relevance: 1.0,
		accessCount: 0,
		createdAt: now,
		lastAccessedAt: now,
	};

	if (db) {
		db.prepare(
			`INSERT INTO episodic_entries
				(id, content, summary, relevance, access_count, created_at, last_accessed_at, type)
			VALUES
				(?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			newEntry.id,
			newEntry.content,
			newEntry.summary,
			newEntry.relevance,
			newEntry.accessCount,
			newEntry.createdAt,
			newEntry.lastAccessedAt,
			newEntry.type,
		);
	}

	return newEntry;
}

/**
 * Finds an entry by ID, increments accessCount, updates lastAccessedAt,
 * recalculates relevance, saves, and returns the updated entry.
 * Returns null if the entry is not found or db is unavailable.
 */
export function accessEntry(
	mainaDir: string,
	id: string,
): EpisodicEntry | null {
	const db = openDb(mainaDir);
	if (!db) return null;

	const row = db
		.prepare("SELECT * FROM episodic_entries WHERE id = ?")
		.get(id) as EpisodicRow | undefined;

	if (!row) return null;

	const entry = rowToEntry(row);
	const now = new Date().toISOString();
	const newAccessCount = entry.accessCount + 1;

	// Recalculate relevance: days since last accessed = 0 (we're accessing now)
	const newRelevance = calculateDecay(0, newAccessCount);

	db.prepare(
		`UPDATE episodic_entries
		SET access_count = ?, last_accessed_at = ?, relevance = ?
		WHERE id = ?`,
	).run(newAccessCount, now, newRelevance, id);

	return {
		...entry,
		accessCount: newAccessCount,
		lastAccessedAt: now,
		relevance: newRelevance,
	};
}

/**
 * Returns all entries (optionally filtered by type), sorted by relevance descending.
 */
export function getEntries(mainaDir: string, type?: string): EpisodicEntry[] {
	const db = openDb(mainaDir);
	if (!db) return [];

	let rows: EpisodicRow[];
	if (type !== undefined) {
		rows = db
			.prepare(
				"SELECT * FROM episodic_entries WHERE type = ? ORDER BY relevance DESC",
			)
			.all(type) as EpisodicRow[];
	} else {
		rows = db
			.prepare("SELECT * FROM episodic_entries ORDER BY relevance DESC")
			.all() as EpisodicRow[];
	}

	return rows.map(rowToEntry);
}

/**
 * Removes entries with relevance < 0.1, then enforces a max of 100 entries
 * by removing the lowest-relevance entries above that count.
 * Returns the total count of pruned entries.
 */
export function pruneEntries(mainaDir: string): number {
	const db = openDb(mainaDir);
	if (!db) return 0;

	// Remove entries below relevance threshold
	const lowRelevance = db
		.prepare("DELETE FROM episodic_entries WHERE relevance < 0.1")
		.run();
	let pruned = lowRelevance.changes;

	// Count remaining entries
	const countRow = db
		.prepare("SELECT COUNT(*) as count FROM episodic_entries")
		.get() as { count: number };
	const total = countRow.count;

	if (total > 100) {
		const excess = total - 100;
		// Delete the lowest-relevance entries beyond the top 100
		const overLimit = db
			.prepare(
				`DELETE FROM episodic_entries WHERE id IN (
					SELECT id FROM episodic_entries ORDER BY relevance ASC LIMIT ?
				)`,
			)
			.run(excess);
		pruned += overLimit.changes;
	}

	return pruned;
}

/**
 * Recalculates relevance for all entries based on current time.
 */
export function decayAllEntries(mainaDir: string): void {
	const db = openDb(mainaDir);
	if (!db) return;

	const rows = db
		.prepare("SELECT * FROM episodic_entries")
		.all() as EpisodicRow[];
	const now = Date.now();

	const update = db.prepare(
		"UPDATE episodic_entries SET relevance = ? WHERE id = ?",
	);

	for (const row of rows) {
		const entry = rowToEntry(row);
		const lastAccessed = new Date(entry.lastAccessedAt).getTime();
		const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);
		const newRelevance = calculateDecay(daysSinceAccess, entry.accessCount);
		update.run(newRelevance, entry.id);
	}
}

/**
 * Formats a list of episodic entries as text for LLM consumption.
 */
export function assembleEpisodicText(entries: EpisodicEntry[]): string {
	if (entries.length === 0) return "";

	const lines: string[] = ["## Episodic Context\n"];

	for (const entry of entries) {
		lines.push(
			`### [${entry.type}] ${entry.summary} (relevance: ${entry.relevance.toFixed(2)})`,
		);
		lines.push(entry.content);
		lines.push("");
	}

	return lines.join("\n");
}
