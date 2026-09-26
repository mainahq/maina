/**
 * A run's lease (FR-HAR-6): `<git-common-dir>/maina/sessions/leases/<runId>.json`
 * records who owns the run (pid and start time), where its checkout is,
 * what it was based on and which PTYs it started. It is claimed atomically
 * (`O_EXCL`) before anything else of the run exists and dropped only after
 * everything else is gone, so whatever a crashed worker left behind is
 * always named by a lease `reclaim` can find.
 *
 * Also here: the repository's worktree lock, which serialises
 * `git worktree add`/`remove` across processes.
 */

import { randomUUID } from "node:crypto";
import {
	closeSync,
	linkSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import type { Result } from "@mainahq/core";
import {
	identify,
	liveness,
	type ProcessIdentity,
	type ProcessTable,
} from "./processes";

export type SessionErrorCode =
	| "invalid_run_id"
	| "not_a_repo"
	| "in_use"
	| "not_found"
	| "corrupt_lease"
	| "spawn_failed"
	| "task_failed"
	| "git_failed"
	| "io";

export type SessionError = Readonly<{
	code: SessionErrorCode;
	message: string;
}>;

/** The ports a session touches; tests swap them. */
export type Lease = Readonly<{
	version: 1;
	runId: string;
	path: string;
	branch: string;
	baseSha: string;
	baseRef: string | null;
	owner: ProcessIdentity;
	ptys: readonly ProcessIdentity[];
	createdAt: string;
}>;

export type LeaseFile = Readonly<{ file: string; lease: Lease }>;

export const runBranch = (runId: string): string => `maina/run/${runId}`;

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Safe as a file name and inside a branch name: git's ref rules included. */
export function validateRunId(runId: string): Result<string, SessionError> {
	return RUN_ID.test(runId) &&
		!runId.includes("..") &&
		!runId.endsWith(".") &&
		!runId.endsWith(".lock")
		? { ok: true, value: runId }
		: {
				ok: false,
				error: {
					code: "invalid_run_id",
					message: `invalid run id ${JSON.stringify(runId)}: use 1-64 letters, digits, ".", "_" or "-", starting with a letter or digit`,
				},
			};
}

export const sessionsDir = (commonDir: string): string =>
	join(commonDir, "maina", "sessions");

export const worktreePath = (commonDir: string, runId: string): string =>
	join(sessionsDir(commonDir), "worktrees", runId);

export const leasesDir = (commonDir: string): string =>
	join(sessionsDir(commonDir), "leases");

export const leasePath = (commonDir: string, runId: string): string =>
	join(leasesDir(commonDir), `${runId}.json`);

export function ioError(e: unknown): SessionError {
	return {
		code: "io",
		message: e instanceof Error ? e.message : String(e),
	};
}

const isIdentity = (v: unknown): v is ProcessIdentity =>
	typeof v === "object" &&
	v !== null &&
	Number.isInteger((v as ProcessIdentity).pid) &&
	(typeof (v as ProcessIdentity).start === "string" ||
		(v as ProcessIdentity).start === null);

/** A lease file's contents, checked field by field. */
function parseLease(text: string): Lease | undefined {
	let v: Partial<Lease>;
	try {
		v = JSON.parse(text) as Partial<Lease>;
	} catch {
		return undefined;
	}
	const ok =
		typeof v === "object" &&
		v !== null &&
		v.version === 1 &&
		typeof v.runId === "string" &&
		validateRunId(v.runId).ok &&
		typeof v.path === "string" &&
		typeof v.branch === "string" &&
		v.branch === runBranch(v.runId) &&
		typeof v.baseSha === "string" &&
		(typeof v.baseRef === "string" || v.baseRef === null) &&
		isIdentity(v.owner) &&
		Array.isArray(v.ptys) &&
		v.ptys.every(isIdentity) &&
		typeof v.createdAt === "string";
	return ok ? (v as Lease) : undefined;
}

export function loadLease(
	commonDir: string,
	runId: string,
): Result<LeaseFile, SessionError> {
	const file = leasePath(commonDir, runId);
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "ENOENT"
			? {
					ok: false,
					error: { code: "not_found", message: `no run ${runId}` },
				}
			: { ok: false, error: ioError(e) };
	}
	const lease = parseLease(text);
	// Cleanup force-removes `lease.path`: a lease naming any other checkout
	// (the user's own worktrees included) is refused, never obeyed.
	return lease !== undefined &&
		lease.runId === runId &&
		lease.path === worktreePath(commonDir, runId)
		? { ok: true, value: { file, lease } }
		: {
				ok: false,
				error: { code: "corrupt_lease", message: `unreadable lease ${file}` },
			};
}

/** The run ids that hold a lease. */
export function listLeases(commonDir: string): readonly string[] {
	try {
		return readdirSync(leasesDir(commonDir))
			.filter((name) => name.endsWith(".json"))
			.map((name) => name.slice(0, -".json".length))
			.filter((runId) => validateRunId(runId).ok)
			.sort();
	} catch {
		return [];
	}
}

/** Creates the lease file, failing with `in_use` if it exists. */
export function claimLease(
	file: string,
	lease: Lease,
): Result<void, SessionError> {
	let fd: number;
	try {
		fd = openSync(file, "wx", 0o600);
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EEXIST"
			? {
					ok: false,
					error: {
						code: "in_use",
						message: `run ${lease.runId} is already claimed`,
					},
				}
			: { ok: false, error: ioError(e) };
	}
	try {
		writeSync(fd, JSON.stringify(lease, null, 2));
		return { ok: true, value: undefined };
	} catch (e) {
		return { ok: false, error: ioError(e) };
	} finally {
		closeSync(fd);
	}
}

/** Adds a PTY to a run's lease, replacing the file atomically. */
export function recordPty(
	worktree: Readonly<{ commonDir: string; runId: string }>,
	pty: ProcessIdentity,
): Result<void, SessionError> {
	const loaded = loadLease(worktree.commonDir, worktree.runId);
	if (!loaded.ok) return loaded;
	const { file, lease } = loaded.value;
	const next: Lease = { ...lease, ptys: [...lease.ptys, pty] };
	const tmp = `${file}.${process.pid}.tmp`;
	try {
		mkdirSync(leasesDir(worktree.commonDir), { recursive: true });
		const fd = openSync(tmp, "w", 0o600);
		try {
			writeSync(fd, JSON.stringify(next, null, 2));
		} finally {
			closeSync(fd);
		}
		renameSync(tmp, file);
		return { ok: true, value: undefined };
	} catch (e) {
		rmSync(tmp, { force: true });
		return { ok: false, error: ioError(e) };
	}
}

export function dropLease(file: string): void {
	rmSync(file, { force: true });
}

// ── the worktree lock ────────────────────────────────────────────────────────

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_POLL_MS = 10;

/**
 * Runs `fn` holding the repository's worktree lock. Concurrent
 * `git worktree add`/`remove` in one repository race: one reads another's
 * half-written `.git/worktrees/<name>` and fails. The lock file names its
 * holder (pid, start time and a nonce), so a lock left by a crashed process
 * is broken instead of waited on, and a holder only ever removes its own.
 */
export async function withWorktreeLock<T>(
	commonDir: string,
	processes: ProcessTable,
	fn: () => Promise<Result<T, SessionError>>,
): Promise<Result<T, SessionError>> {
	const dir = sessionsDir(commonDir);
	const file = join(dir, "worktrees.lock");
	// The nonce tells this holder apart from every other, this process's own
	// concurrent callers included.
	const me = JSON.stringify({
		...identify(processes, process.pid),
		nonce: randomUUID(),
	});
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		const taken = takeLock(dir, file, me);
		if (!taken.ok) return taken;
		if (taken.value) break;
		if (breakIfStale(file, processes)) continue;
		if (Date.now() > deadline) {
			return {
				ok: false,
				error: {
					code: "in_use",
					message: `timed out waiting for ${file}; remove it if no maina run is active`,
				},
			};
		}
		await Bun.sleep(LOCK_POLL_MS);
	}
	try {
		return await fn();
	} finally {
		releaseLock(file, me);
	}
}

/**
 * Creates the lock with its holder already in it: written to a private
 * file, then hard-linked into place, which fails with EEXIST while the lock
 * is held. So the lock never exists empty, even if its holder dies at once.
 */
function takeLock(
	dir: string,
	file: string,
	me: string,
): Result<boolean, SessionError> {
	const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(tmp, me, { mode: 0o600 });
		linkSync(tmp, file);
		return { ok: true, value: true };
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EEXIST"
			? { ok: true, value: false }
			: { ok: false, error: ioError(e) };
	} finally {
		rmSync(tmp, { force: true });
	}
}

/**
 * Removes the lock if its holder has crashed; true when the caller should
 * try to take it again at once. The lock is moved aside atomically before
 * it is judged a second time: another waiter that saw the same crashed
 * holder may have broken the lock and taken it since it was read, and that
 * live lock is put back, never deleted.
 */
function breakIfStale(file: string, processes: ProcessTable): boolean {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		// Released since the take failed: take it.
		return true;
	}
	if (!holderGone(text, processes)) return false;
	const aside = `${file}.${process.pid}.${randomUUID()}.stale`;
	try {
		renameSync(file, aside);
	} catch {
		return true;
	}
	try {
		if (readFileSync(aside, "utf8") !== text) {
			try {
				linkSync(aside, file);
			} catch {
				// Someone took the lock meanwhile; theirs stands.
			}
		}
	} catch {
		// Unreadable once moved: it was the stale one.
	} finally {
		rmSync(aside, { force: true });
	}
	return true;
}

function holderGone(text: string, processes: ProcessTable): boolean {
	let holder: unknown;
	try {
		holder = JSON.parse(text);
	} catch {
		return false;
	}
	return isIdentity(holder) && liveness(processes, holder) === "gone";
}

/** Removes the lock only while it is still this holder's. */
function releaseLock(file: string, me: string): void {
	try {
		if (readFileSync(file, "utf8") === me) rmSync(file, { force: true });
	} catch {
		// Already gone.
	}
}
