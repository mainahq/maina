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

/** Creates the decision log table, its indexes and its append-only guards. */
export function migrateDecisionLog(db: DbPort): Result<void, DbError> {
	for (const statement of DECISION_LOG_MIGRATION) {
		const applied = db.run(statement);
		if (!applied.ok) return applied;
	}
	return { ok: true, value: undefined };
}
