/**
 * The `.maina` SQLite stores as the published API hands them out (#392): a
 * `DbPort` plus `close`. The raw connection and the Drizzle instance stay
 * inside core, so the public declarations never name `bun:sqlite` or
 * `drizzle-orm` and a Node consumer can typecheck against them.
 */

import type { DbPort } from "../ports/db";
import {
	type DbHandle,
	getDecisionDb,
	getFeedbackDb,
	type Result,
} from "./index";
import { toDbPort } from "./port";

/** An open store: SQL access through the port, and a way to release it. */
export type DbStore = Readonly<{ db: DbPort; close: () => void }>;

function asStore(handle: Result<DbHandle>): Result<DbStore> {
	if (!handle.ok) return handle;
	const { db } = handle.value;
	return { ok: true, value: { db: toDbPort(db), close: () => db.close() } };
}

/** Open `.maina/decisions.db`. Migrations are the caller's (they take a `DbPort`). */
export function openDecisionStore(mainaDir: string): Result<DbStore> {
	return asStore(getDecisionDb(mainaDir));
}

/** Open `.maina/feedback.db` with its tables created. */
export function openFeedbackStore(mainaDir: string): Result<DbStore> {
	return asStore(getFeedbackDb(mainaDir));
}
