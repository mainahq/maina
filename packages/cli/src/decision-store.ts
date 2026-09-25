/**
 * The decision store the CLI hands core: `.maina/decisions.db` as a
 * `DbPort`, with the decision log, outcome and gate subject tables migrated.
 * Kept apart from `ports.ts` so commands that never touch decisions do not
 * load the SQLite store.
 */

import {
	type DbPort,
	getDecisionDb,
	migrateDecisionOutcomes,
	migrateGateSubjects,
	type Result,
	toDbPort,
} from "@mainahq/core";

/** Opens and migrates the decision database under `mainaDir`. Call `close` when done. */
export function openDecisionDb(
	mainaDir: string,
): Result<Readonly<{ db: DbPort; close: () => void }>, string> {
	const handle = getDecisionDb(mainaDir);
	if (!handle.ok) return handle;
	const db = toDbPort(handle.value.db);
	const close = () => handle.value.db.close();
	const migrated = migrateDecisionOutcomes(db);
	const subjects = migrated.ok ? migrateGateSubjects(db) : migrated;
	if (!subjects.ok) {
		close();
		return { ok: false, error: subjects.error.message };
	}
	return { ok: true, value: { db, close } };
}
