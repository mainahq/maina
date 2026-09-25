/**
 * The `DbPort` over an open SQLite connection: the real adapter for the port
 * core's decision log, outcomes and gate subjects are written against.
 * Failures come back as `Result`; nothing throws past it.
 */

import type { DbError, DbPort, DbRow, DbValue } from "../ports/db";
import type { SqlBinding, SqliteDatabase } from "./index";

function queryFailed(error: unknown): DbError {
	return {
		kind: "query_failed",
		message: error instanceof Error ? error.message : String(error),
	};
}

const bindings = (params: readonly DbValue[]): SqlBinding[] => [...params];

export function toDbPort(db: SqliteDatabase): DbPort {
	return {
		run: (sql, params = []) => {
			try {
				db.prepare(sql).run(...bindings(params));
				return { ok: true, value: undefined };
			} catch (error) {
				return { ok: false, error: queryFailed(error) };
			}
		},
		all: (sql, params = []) => {
			try {
				const rows = db.prepare(sql).all(...bindings(params)) as DbRow[];
				return { ok: true, value: rows };
			} catch (error) {
				return { ok: false, error: queryFailed(error) };
			}
		},
	};
}
