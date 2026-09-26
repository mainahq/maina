/**
 * The decision store the CLI hands core: `.maina/decisions.db` as a
 * `DbPort`, with the decision log, outcome and gate subject tables migrated.
 * Kept apart from `ports.ts` so commands that never touch decisions do not
 * load the SQLite store.
 */

import {
	type DbStore,
	migrateDecisionOutcomes,
	migrateGateSubjects,
	openDecisionStore,
	type Result,
} from "@mainahq/core";

/** Opens and migrates the decision database under `mainaDir`. Call `close` when done. */
export function openDecisionDb(mainaDir: string): Result<DbStore, string> {
	const store = openDecisionStore(mainaDir);
	if (!store.ok) return store;
	const { db, close } = store.value;
	const migrated = migrateDecisionOutcomes(db);
	const subjects = migrated.ok ? migrateGateSubjects(db) : migrated;
	if (!subjects.ok) {
		close();
		return { ok: false, error: subjects.error.message };
	}
	return store;
}
