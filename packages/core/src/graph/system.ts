/**
 * Real adapters for the code-graph store: the working-tree filesystem, git
 * through the system `ProcessPort`, and the store's SQLite file under
 * `.maina/graph/`. The context engine opens the store here when its caller
 * hands it no ports, and the runtime opens it here to keep it current
 * (FR-GRAPH-2). Adapters never throw; failures come back as `Result`.
 */

import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { initDatabase, type Result, type SqliteDatabase } from "../db/index";
import { createProcessGit } from "../git/index";
import type { DbPort, DbRow, DbValue, FsError, FsPort } from "../ports/index";
import { systemProcess } from "../process/index";
import type { GraphStorePorts } from "./store/types";

function fsError(path: string, error: unknown): FsError {
	const code = (error as { code?: unknown } | null)?.code;
	if (code === "ENOENT" || code === "ENOTDIR") {
		return { kind: "not_found", path };
	}
	return {
		kind: "io",
		path,
		message: error instanceof Error ? error.message : String(error),
	};
}

/** `node:fs`-backed `FsPort`. */
export const systemFs: FsPort = {
	readFile: async (path) => {
		try {
			return { ok: true, value: await readFile(path, "utf-8") };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
	writeFile: async (path, content) => {
		try {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, "utf-8");
			return { ok: true, value: undefined };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
	exists: async (path) => {
		try {
			await stat(path);
			return true;
		} catch {
			return false;
		}
	},
	readDir: async (path) => {
		try {
			return { ok: true, value: (await readdir(path)).sort() };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
	remove: async (path) => {
		try {
			await stat(path);
			await rm(path, { recursive: true, force: true });
			return { ok: true, value: undefined };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
};

const queryFailed = (error: unknown) =>
	({
		kind: "query_failed",
		message: error instanceof Error ? error.message : String(error),
	}) as const;

/** A `DbPort` over an open SQLite connection. */
function sqliteDbPort(db: SqliteDatabase): DbPort {
	const bind = (params: readonly DbValue[]) => params as DbValue[];
	return {
		run: (sql, params = []) => {
			try {
				db.prepare(sql).run(...bind(params));
				return { ok: true, value: undefined };
			} catch (error) {
				return { ok: false, error: queryFailed(error) };
			}
		},
		all: (sql, params = []) => {
			try {
				const rows = db.prepare(sql).all(...bind(params));
				return { ok: true, value: rows as DbRow[] };
			} catch (error) {
				return { ok: false, error: queryFailed(error) };
			}
		},
	};
}

/** The store's database file for a `.maina` directory. */
const codeGraphDbPath = (mainaDir: string): string =>
	join(mainaDir, "graph", "index.db");

export type OpenGraphError = Readonly<{
	kind: "open_failed";
	path: string;
	message: string;
}>;

export type OpenedGraph = Readonly<{
	ports: GraphStorePorts;
	/** Closes the database; the ports must not be used afterwards. */
	close: () => void;
}>;

/** How long a writer waits for another process's graph transaction. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens the code-graph store under `mainaDir` (creating it on first use)
 * with the system filesystem and git. The runtime and the context engine
 * can both hold it open: SQLite runs in WAL mode and a writer waits for
 * the other's transaction instead of failing.
 */
export function openCodeGraph(
	mainaDir: string,
): Result<OpenedGraph, OpenGraphError> {
	const path = codeGraphDbPath(mainaDir);
	const opened = initDatabase(path);
	if (!opened.ok) {
		return {
			ok: false,
			error: { kind: "open_failed", path, message: opened.error },
		};
	}
	const { db } = opened.value;
	try {
		db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS};`);
	} catch (error) {
		db.close();
		return {
			ok: false,
			error: {
				kind: "open_failed",
				path,
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
	return {
		ok: true,
		value: {
			ports: {
				fs: systemFs,
				git: createProcessGit(systemProcess),
				db: sqliteDbPort(db),
			},
			close: () => {
				try {
					db.close();
				} catch {
					// Already closed.
				}
			},
		},
	};
}
