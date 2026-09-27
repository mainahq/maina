/**
 * Migration for the append-only decision log (FR-DEC-3). The table has no
 * update or delete path: triggers abort any UPDATE, DELETE or insert that
 * would replace an existing entry (`INSERT OR REPLACE`, `REPLACE INTO`), so
 * the guarantee holds even for SQL written outside `decide/log`.
 *
 * Every statement is idempotent; run `migrateDecisionLog` once per
 * connection before appending or querying.
 */

import type { DbError, DbPort } from "../ports/db";
import type { Result } from "./index";

const APPEND_ONLY = "SELECT RAISE(ABORT, 'decision_log is append-only');";

export const DECISION_LOG_MIGRATION: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS decision_log (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		id TEXT NOT NULL UNIQUE,
		ts INTEGER NOT NULL,
		type TEXT NOT NULL,
		input_hash TEXT NOT NULL,
		schema_hash TEXT NOT NULL,
		option_order TEXT NOT NULL,
		policy_hash TEXT NOT NULL,
		model_hash TEXT NOT NULL,
		distribution TEXT NOT NULL,
		answer TEXT NOT NULL,
		final_action TEXT NOT NULL,
		latency_ms REAL NOT NULL,
		host TEXT,
		session_id TEXT
	)`,
	"CREATE INDEX IF NOT EXISTS idx_decision_log_type_ts ON decision_log(type, ts)",
	"CREATE INDEX IF NOT EXISTS idx_decision_log_replay ON decision_log(input_hash, policy_hash, model_hash)",
	"CREATE INDEX IF NOT EXISTS idx_decision_log_session ON decision_log(session_id)",
	`CREATE TRIGGER IF NOT EXISTS decision_log_no_update
		BEFORE UPDATE ON decision_log
		BEGIN ${APPEND_ONLY} END`,
	`CREATE TRIGGER IF NOT EXISTS decision_log_no_delete
		BEFORE DELETE ON decision_log
		BEGIN ${APPEND_ONLY} END`,
	`CREATE TRIGGER IF NOT EXISTS decision_log_no_replace
		BEFORE INSERT ON decision_log
		WHEN EXISTS (
			SELECT 1 FROM decision_log WHERE id = NEW.id OR seq = NEW.seq
		)
		BEGIN ${APPEND_ONLY} END`,
];

/**
 * Columns added after the table shipped, in order: decision diagnostics
 * (#577), numbers only, `NULL` on every row logged before them. Adding a
 * nullable column rewrites no row, so the log stays append-only. Only ever
 * append to this list.
 */
const DECISION_LOG_ADDED_COLUMNS: readonly (readonly [
	name: string,
	type: "TEXT" | "REAL" | "INTEGER",
])[] = [
	// JSON list of probabilities, in `option_order` order.
	["calibrated", "TEXT"],
	["escalate", "REAL"],
	// 0 or 1.
	["truncated", "INTEGER"],
	["windows", "INTEGER"],
	// JSON object: action class id -> probability.
	["action_class_probs", "TEXT"],
];

/**
 * Creates the decision log table, its indexes and its append-only guards,
 * and adds any of `DECISION_LOG_ADDED_COLUMNS` the table lacks. Idempotent.
 */
export function migrateDecisionLog(db: DbPort): Result<void, DbError> {
	for (const statement of DECISION_LOG_MIGRATION) {
		const applied = db.run(statement);
		if (!applied.ok) return applied;
	}
	const columns = db.all("PRAGMA table_info(decision_log)");
	if (!columns.ok) return columns;
	const present = new Set(columns.value.map((c) => c.name));
	for (const [name, type] of DECISION_LOG_ADDED_COLUMNS) {
		if (present.has(name)) continue;
		const added = db.run(`ALTER TABLE decision_log ADD COLUMN ${name} ${type}`);
		if (!added.ok) return added;
	}
	return { ok: true, value: undefined };
}
