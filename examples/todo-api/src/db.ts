import { Database } from "bun:sqlite";

let db: Database | null = null;

export function getDb(path = "./todos.db"): Database {
	if (!db) {
		db = new Database(path, { create: true });
		db.run("PRAGMA journal_mode = WAL");
		db.run(`
			CREATE TABLE IF NOT EXISTS todos (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				title TEXT NOT NULL,
				completed INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
	}
	return db;
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}
