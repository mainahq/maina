/**
 * In-memory fakes for every `CorePorts` member. They never touch the real
 * filesystem, network, git binary, clock or environment, and they report
 * failures as `Result` errors rather than throwing.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { posix } from "node:path";
import type { Result } from "../db/index";
import type { ClockPort } from "./clock";
import type { DbError, DbPort, DbRow } from "./db";
import type { EnvPort } from "./env";
import type { FsError, FsPort } from "./fs";
import type { GitPort } from "./git";
import type { CorePorts } from "./index";
import type { LogFields, LoggerPort, LogLevel } from "./logger";
import type { ModelPort, ModelRequest } from "./model";

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

// ── fs ──────────────────────────────────────────────────────────────────────

export function createMemoryFs(
	initial: Readonly<Record<string, string>> = {},
): FsPort {
	const files = new Map<string, string>(
		Object.entries(initial).map(([path, content]) => [
			posix.normalize(path),
			content,
		]),
	);
	const dirPrefix = (path: string): string =>
		path.endsWith("/") ? path : `${path}/`;
	const childrenOf = (dir: string): readonly string[] =>
		[...files.keys()].filter((key) => key.startsWith(dirPrefix(dir)));
	const notFound = (path: string): FsError => ({ kind: "not_found", path });

	return {
		readFile: async (path) => {
			const content = files.get(posix.normalize(path));
			return content === undefined ? err(notFound(path)) : ok(content);
		},
		writeFile: async (path, content) => {
			files.set(posix.normalize(path), content);
			return ok(undefined);
		},
		exists: async (path) => {
			const key = posix.normalize(path);
			return files.has(key) || childrenOf(key).length > 0;
		},
		readDir: async (path) => {
			const key = posix.normalize(path);
			const children = childrenOf(key);
			if (children.length === 0) return err(notFound(path));
			const prefix = dirPrefix(key);
			const names = new Set(
				children.map((child) => child.slice(prefix.length).split("/")[0] ?? ""),
			);
			return ok([...names].sort());
		},
		remove: async (path) => {
			const key = posix.normalize(path);
			const targets = files.has(key) ? [key] : childrenOf(key);
			if (targets.length === 0) return err(notFound(path));
			for (const target of targets) files.delete(target);
			return ok(undefined);
		},
	};
}

// ── git ─────────────────────────────────────────────────────────────────────

export type GitCall = Readonly<{ root: string; args: readonly string[] }>;

export type FakeGit = GitPort & Readonly<{ calls: () => readonly GitCall[] }>;

/** Scripted git: keys are the space-joined args, values are stdout. */
export function createFakeGit(
	responses: Readonly<Record<string, string>> = {},
): FakeGit {
	const calls: GitCall[] = [];
	return {
		run: async (root, args) => {
			calls.push({ root, args: [...args] });
			const stdout = responses[args.join(" ")];
			return stdout === undefined
				? err({
						kind: "failed",
						exitCode: 1,
						stderr: `fake git: no response scripted for "${args.join(" ")}"`,
					})
				: ok(stdout);
		},
		calls: () => [...calls],
	};
}

// ── db ──────────────────────────────────────────────────────────────────────

function queryFailed(error: unknown): DbError {
	return {
		kind: "query_failed",
		message: error instanceof Error ? error.message : String(error),
	};
}

/** A private `:memory:` SQLite database: real SQL semantics, no files. */
export function createMemoryDb(): DbPort {
	const db = new Database(":memory:");
	const bind = (params: readonly unknown[]): SQLQueryBindings[] =>
		params as SQLQueryBindings[];
	return {
		run: (sql, params = []) => {
			try {
				db.prepare(sql).run(...bind(params));
				return ok(undefined);
			} catch (error) {
				return err(queryFailed(error));
			}
		},
		all: (sql, params = []) => {
			try {
				return ok(db.prepare(sql).all(...bind(params)) as DbRow[]);
			} catch (error) {
				return err(queryFailed(error));
			}
		},
	};
}

// ── clock ───────────────────────────────────────────────────────────────────

export type FixedClock = ClockPort &
	Readonly<{ advance: (ms: number) => void }>;

export function createFixedClock(startMs = 0): FixedClock {
	let now = startMs;
	return {
		now: () => now,
		advance: (ms) => {
			now += ms;
		},
	};
}

// ── logger ──────────────────────────────────────────────────────────────────

export type LogEntry = Readonly<{
	level: LogLevel;
	message: string;
	fields: LogFields | undefined;
}>;

export type MemoryLogger = LoggerPort &
	Readonly<{ entries: () => readonly LogEntry[] }>;

export function createMemoryLogger(): MemoryLogger {
	const entries: LogEntry[] = [];
	const at =
		(level: LogLevel) =>
		(message: string, fields?: LogFields): void => {
			entries.push({ level, message, fields });
		};
	return {
		debug: at("debug"),
		info: at("info"),
		warn: at("warn"),
		error: at("error"),
		entries: () => [...entries],
	};
}

// ── model ───────────────────────────────────────────────────────────────────

export type FakeModel = ModelPort &
	Readonly<{ requests: () => readonly ModelRequest[] }>;

/** Without a responder every call is `unavailable`, like an offline host. */
export function createFakeModel(
	respond?: (request: ModelRequest) => string,
): FakeModel {
	const requests: ModelRequest[] = [];
	return {
		generate: async (request) => {
			requests.push(request);
			return respond === undefined
				? err({ kind: "unavailable", message: "fake model has no responder" })
				: ok({ text: respond(request), model: "fake" });
		},
		requests: () => [...requests],
	};
}

// ── env ─────────────────────────────────────────────────────────────────────

export function createFakeEnv(
	vars: Readonly<Record<string, string>> = {},
): EnvPort {
	return {
		get: (name) => (Object.hasOwn(vars, name) ? vars[name] : undefined),
	};
}

// ── bundle ──────────────────────────────────────────────────────────────────

/** A complete in-memory `CorePorts`; pass overrides for the ports under test. */
export function createFakePorts(overrides: Partial<CorePorts> = {}): CorePorts {
	return {
		fs: createMemoryFs(),
		git: createFakeGit(),
		db: createMemoryDb(),
		clock: createFixedClock(),
		logger: createMemoryLogger(),
		model: createFakeModel(),
		env: createFakeEnv(),
		...overrides,
	};
}
