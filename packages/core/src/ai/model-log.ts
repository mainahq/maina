/**
 * A `LoggerPort` that keeps its entries in SQLite (#463), so the routing
 * log `generate()` writes (the tier, the budget breach, the savings
 * estimate) outlives the command instead of going to a silent logger. It
 * never writes to stdout or stderr and never throws: a failed write or
 * unserialisable fields drop only that entry's fields or the entry itself.
 */

import type { Result } from "../db/index";
import type { ClockPort } from "../ports/clock";
import type { DbError, DbPort } from "../ports/db";
import type { LogFields, LoggerPort, LogLevel } from "../ports/logger";
import { migrate } from "./spend";

const MODEL_LOG_MIGRATION: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS model_log (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		ts INTEGER NOT NULL,
		level TEXT NOT NULL,
		message TEXT NOT NULL,
		fields TEXT
	)`,
	"CREATE INDEX IF NOT EXISTS idx_model_log_ts ON model_log(ts)",
];

function serialise(fields: LogFields | undefined): string | null {
	if (fields === undefined) return null;
	try {
		return JSON.stringify(fields);
	} catch {
		return null;
	}
}

/** The logger over `db`, creating its table on first use. */
export function createDbLogger(
	ports: Readonly<{ db: DbPort; clock: ClockPort }>,
): Result<LoggerPort, DbError> {
	const { db, clock } = ports;
	const migrated = migrate(db, MODEL_LOG_MIGRATION);
	if (!migrated.ok) return migrated;
	const at =
		(level: LogLevel) =>
		(message: string, fields?: LogFields): void => {
			// Logging is best effort: a failed insert is dropped.
			db.run(
				"INSERT INTO model_log (ts, level, message, fields) VALUES (?, ?, ?, ?)",
				[clock.now(), level, message, serialise(fields)],
			);
		};
	return {
		ok: true,
		value: {
			debug: at("debug"),
			info: at("info"),
			warn: at("warn"),
			error: at("error"),
		},
	};
}
