/**
 * Migration for decision outcomes (FR-DEC-4): `decision_commit` links log
 * entries to the commit they were made for, `decision_outcome` records what
 * happened afterwards. Both are append-only, like the decision log itself.
 *
 * Every statement is idempotent. `migrateDecisionOutcomes` also migrates the
 * decision log, so one call prepares a connection for outcome capture.
 */

import type { DbError, DbPort } from "../ports/db";
import { migrateDecisionLog } from "./decision-log";
import type { Result } from "./index";

const APPEND_ONLY = (table: string): string =>
	`SELECT RAISE(ABORT, '${table} is append-only');`;

const guards = (table: string, keyClause: string): readonly string[] => [
	`CREATE TRIGGER IF NOT EXISTS ${table}_no_update
		BEFORE UPDATE ON ${table}
		BEGIN ${APPEND_ONLY(table)} END`,
	`CREATE TRIGGER IF NOT EXISTS ${table}_no_delete
		BEFORE DELETE ON ${table}
		BEGIN ${APPEND_ONLY(table)} END`,
	`CREATE TRIGGER IF NOT EXISTS ${table}_no_replace
		BEFORE INSERT ON ${table}
		WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${keyClause})
		BEGIN ${APPEND_ONLY(table)} END`,
];

export const DECISION_OUTCOMES_MIGRATION: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS decision_commit (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		decision_id TEXT NOT NULL,
		commit_sha TEXT NOT NULL,
		UNIQUE (decision_id, commit_sha)
	)`,
	"CREATE INDEX IF NOT EXISTS idx_decision_commit_sha ON decision_commit(commit_sha)",
	...guards(
		"decision_commit",
		"(decision_id = NEW.decision_id AND commit_sha = NEW.commit_sha) OR seq = NEW.seq",
	),
	`CREATE TABLE IF NOT EXISTS decision_outcome (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		id TEXT NOT NULL UNIQUE,
		decision_id TEXT NOT NULL,
		outcome TEXT NOT NULL,
		source TEXT NOT NULL,
		ref TEXT,
		ts INTEGER NOT NULL
	)`,
	"CREATE INDEX IF NOT EXISTS idx_decision_outcome_decision ON decision_outcome(decision_id)",
	...guards("decision_outcome", "id = NEW.id OR seq = NEW.seq"),
];

/** Creates the decision log and the outcome tables with their guards. */
export function migrateDecisionOutcomes(db: DbPort): Result<void, DbError> {
	const log = migrateDecisionLog(db);
	if (!log.ok) return log;
	for (const statement of DECISION_OUTCOMES_MIGRATION) {
		const applied = db.run(statement);
		if (!applied.ok) return applied;
	}
	return { ok: true, value: undefined };
}
