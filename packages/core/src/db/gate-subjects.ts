/**
 * Migration for gate subjects (FR-GATE-8): what a gate decision was about
 * (the event kind, the exact commands, path, tool or URL, the classes), so
 * `maina allow <id> --always` can write a rule scoped to that action.
 *
 * The decision log keeps only hashes and labels; this table is the local
 * record behind it. It stays on this machine: outcome sharing never reads
 * it. One row per decision id, written once.
 */

import type { DbError, DbPort } from "../ports/db";
import type { Result } from "./index";

const GATE_SUBJECTS_MIGRATION: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS gate_subject (
		decision_id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		targets TEXT NOT NULL,
		classes TEXT NOT NULL,
		rule TEXT NOT NULL,
		irreversible INTEGER NOT NULL
	)`,
];

/** Creates the gate subject table. Idempotent. */
export function migrateGateSubjects(db: DbPort): Result<void, DbError> {
	for (const statement of GATE_SUBJECTS_MIGRATION) {
		const applied = db.run(statement);
		if (!applied.ok) return applied;
	}
	return { ok: true, value: undefined };
}
