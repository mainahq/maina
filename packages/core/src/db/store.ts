/**
 * SQLite stores as the package hands them out (#392): a `DbPort` plus
 * `close`. The raw connection and its drizzle instance stay inside core, so
 * the published declarations never name a `bun:sqlite` or drizzle type (a
 * Node consumer with `skipLibCheck: false` cannot resolve either).
 */

import type { DbPort } from "../ports/db";
import {
	type DbHandle,
	getDecisionDb,
	getFeedbackDb,
	type Result,
} from "./index";
import { toDbPort } from "./port";

/** An open store. Call `close` when done; the port fails after it. */
export type DbStore = Readonly<{ db: DbPort; close: () => void }>;

function asStore(handle: Result<DbHandle>): Result<DbStore> {
	if (!handle.ok) return handle;
	const { db } = handle.value;
	return { ok: true, value: { db: toDbPort(db), close: () => db.close() } };
}

/** Opens `.maina/feedback.db` (feedback, prompt versions, review findings). */
export function openFeedbackStore(mainaDir: string): Result<DbStore> {
	return asStore(getFeedbackDb(mainaDir));
}

/**
 * Opens `.maina/decisions.db`. Its tables are created by the decision log,
 * outcome and gate subject migrations, run over the returned port.
 */
export function openDecisionStore(mainaDir: string): Result<DbStore> {
	return asStore(getDecisionDb(mainaDir));
}
