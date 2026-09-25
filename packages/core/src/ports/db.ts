import type { Result } from "../db/index";

export type DbValue = string | number | bigint | boolean | null | Uint8Array;

export type DbRow = Readonly<Record<string, DbValue>>;

export type DbError = Readonly<{ kind: "query_failed"; message: string }>;

/** Synchronous SQL access with bun:sqlite semantics. */
export type DbPort = Readonly<{
	/** Run a statement that returns no rows. */
	run: (sql: string, params?: readonly DbValue[]) => Result<void, DbError>;
	/** Run a query and return every row. */
	all: (
		sql: string,
		params?: readonly DbValue[],
	) => Result<readonly DbRow[], DbError>;
}>;
