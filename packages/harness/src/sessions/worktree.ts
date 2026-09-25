/**
 * One git worktree per run (FR-HAR-6), so parallel runs never share a
 * checkout.
 *
 * `createWorktree(root, runId)` checks the run out on its own branch,
 * `maina/run/<runId>`, from the root's current commit. Checkouts live in the
 * repository's shared git directory (`<git-common-dir>/maina/sessions/`),
 * where the root's own tools, tests and `git status` never see them, and
 * which every worktree of the repository agrees on.
 *
 * Each run holds a lease, `sessions/leases/<runId>.json`: who owns it (pid
 * and start time), where its checkout is, what it was based on and which
 * PTYs it started. The lease is claimed atomically (`O_EXCL`) before
 * anything else exists and dropped only after everything else is gone, so
 * two claims on one run id can never both win, and whatever a crashed
 * worker left behind is always named by a lease that `reclaim` can find.
 */

import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { type ProcessPort, type Result, systemProcess } from "@mainahq/core";
import {
	identify,
	liveness,
	type ProcessIdentity,
	type ProcessTable,
	systemProcesses,
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
export type SessionDeps = Readonly<{
	git: ProcessPort;
	processes: ProcessTable;
}>;

export const resolveDeps = (deps: Partial<SessionDeps> = {}): SessionDeps => ({
	git: deps.git ?? systemProcess,
	processes: deps.processes ?? systemProcesses,
});

export type Worktree = Readonly<{
	runId: string;
	/** The run's checkout. */
	path: string;
	/** `maina/run/<runId>`. */
	branch: string;
	/** The commit the run started from. */
	baseSha: string;
	/** The branch the root was on, which "merged" is judged against; null when detached. */
	baseRef: string | null;
	/** The repository's shared git directory. */
	commonDir: string;
}>;

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

// ── git ──────────────────────────────────────────────────────────────────────

type GitOutput = Readonly<{
	code: number;
	stdout: string;
	stderr: string;
}>;

/** Another git process holds a lock this one needs: worth a retry. */
const LOCKED =
	/\.lock'?:? File exists|Unable to create '.*\.lock'|could not lock/i;
const LOCK_RETRIES = 5;

/** Runs git; a non-zero exit is data. Retries briefly while a lock is held. */
export async function git(
	port: ProcessPort,
	cwd: string,
	args: readonly string[],
): Promise<Result<GitOutput, SessionError>> {
	for (let attempt = 1; ; attempt++) {
		const ran = await port.spawn(["git", ...args], { cwd });
		if (!ran.ok) {
			return {
				ok: false,
				error: {
					code: "git_failed",
					message: `git ${args[0]} in ${cwd}: ${ran.error.kind === "timeout" ? "timed out" : ran.error.message}`,
				},
			};
		}
		const { exitCode, stdout, stderr } = ran.value;
		if (exitCode !== 0 && LOCKED.test(stderr) && attempt < LOCK_RETRIES) {
			await Bun.sleep(20 * attempt);
			continue;
		}
		return {
			ok: true,
			value: { code: exitCode, stdout: stdout.trim(), stderr: stderr.trim() },
		};
	}
}

/** Runs git and wants exit 0: anything else is `git_failed`. */
export async function gitOk(
	port: ProcessPort,
	cwd: string,
	args: readonly string[],
): Promise<Result<string, SessionError>> {
	const ran = await git(port, cwd, args);
	if (!ran.ok) return ran;
	return ran.value.code === 0
		? { ok: true, value: ran.value.stdout }
		: {
				ok: false,
				error: {
					code: "git_failed",
					message: `git ${args.join(" ")}: ${ran.value.stderr || `exit ${ran.value.code}`}`,
				},
			};
}

export const branchExists = async (
	port: ProcessPort,
	cwd: string,
	branch: string,
): Promise<Result<boolean, SessionError>> => {
	const ran = await git(port, cwd, [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/heads/${branch}`,
	]);
	return ran.ok ? { ok: true, value: ran.value.code === 0 } : ran;
};

export type Repo = Readonly<{
	/** The working tree `root` belongs to. */
	top: string;
	commonDir: string;
}>;

export async function findRepo(
	port: ProcessPort,
	root: string,
): Promise<Result<Repo, SessionError>> {
	const ran = await git(port, root, [
		"rev-parse",
		"--path-format=absolute",
		"--show-toplevel",
		"--git-common-dir",
	]);
	const [top, commonDir] = ran.ok ? ran.value.stdout.split("\n") : [];
	if (!ran.ok || ran.value.code !== 0 || !top || !commonDir) {
		return {
			ok: false,
			error: {
				code: "not_a_repo",
				message: `${root} is not inside a git working tree`,
			},
		};
	}
	try {
		return {
			ok: true,
			value: { top: realpathSync(top), commonDir: realpathSync(commonDir) },
		};
	} catch (e) {
		return { ok: false, error: ioError(e) };
	}
}

// ── leases ───────────────────────────────────────────────────────────────────

const sessionsDir = (commonDir: string): string =>
	join(commonDir, "maina", "sessions");

const worktreePath = (commonDir: string, runId: string): string =>
	join(sessionsDir(commonDir), "worktrees", runId);

const leasesDir = (commonDir: string): string =>
	join(sessionsDir(commonDir), "leases");

const leasePath = (commonDir: string, runId: string): string =>
	join(leasesDir(commonDir), `${runId}.json`);

function ioError(e: unknown): SessionError {
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
function claimLease(file: string, lease: Lease): Result<void, SessionError> {
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
	worktree: Worktree,
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
 * holder (pid and start time), so a lock left by a crashed process is
 * broken instead of waited on.
 */
export async function withWorktreeLock<T>(
	commonDir: string,
	processes: ProcessTable,
	fn: () => Promise<Result<T, SessionError>>,
): Promise<Result<T, SessionError>> {
	const file = join(sessionsDir(commonDir), "worktrees.lock");
	const me = JSON.stringify(identify(processes, process.pid));
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			mkdirSync(sessionsDir(commonDir), { recursive: true });
			const fd = openSync(file, "wx", 0o600);
			try {
				writeSync(fd, me);
			} finally {
				closeSync(fd);
			}
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
				return { ok: false, error: ioError(e) };
			}
		}
		if (lockHolderGone(file, processes)) {
			rmSync(file, { force: true });
			continue;
		}
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
		rmSync(file, { force: true });
	}
}

function lockHolderGone(file: string, processes: ProcessTable): boolean {
	let holder: unknown;
	try {
		holder = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		// Mid-write, or already released: look again.
		return false;
	}
	return isIdentity(holder) && liveness(processes, holder) === "gone";
}

// ── public ───────────────────────────────────────────────────────────────────

export async function readLease(
	root: string,
	runId: string,
	deps: Partial<SessionDeps> = {},
): Promise<Result<LeaseFile, SessionError>> {
	const id = validateRunId(runId);
	if (!id.ok) return id;
	const repo = await findRepo(resolveDeps(deps).git, root);
	return repo.ok ? loadLease(repo.value.commonDir, runId) : repo;
}

/**
 * Claims `runId` and checks it out on its own branch from the commit `root`
 * is on. Fails with `in_use` when the run id is taken: by a live lease, or by
 * a branch an earlier run with unmerged commits left behind.
 */
export async function createWorktree(
	root: string,
	runId: string,
	deps: Partial<SessionDeps> = {},
): Promise<Result<Worktree, SessionError>> {
	const id = validateRunId(runId);
	if (!id.ok) return id;
	const { git: port, processes } = resolveDeps(deps);

	const repo = await findRepo(port, root);
	if (!repo.ok) return repo;
	const { top, commonDir } = repo.value;

	const head = await gitOk(port, root, ["rev-parse", "--verify", "HEAD"]);
	if (!head.ok) return head;
	const symbolic = await git(port, root, [
		"symbolic-ref",
		"-q",
		"--short",
		"HEAD",
	]);
	if (!symbolic.ok) return symbolic;

	const branch = runBranch(runId);
	const path = worktreePath(commonDir, runId);
	const lease: Lease = {
		version: 1,
		runId,
		path,
		branch,
		baseSha: head.value,
		baseRef: symbolic.value.code === 0 ? symbolic.value.stdout : null,
		owner: identify(processes, processes.self),
		ptys: [],
		createdAt: new Date().toISOString(),
	};

	const file = leasePath(commonDir, runId);
	try {
		mkdirSync(leasesDir(commonDir), { recursive: true });
		mkdirSync(join(sessionsDir(commonDir), "worktrees"), { recursive: true });
	} catch (e) {
		return { ok: false, error: ioError(e) };
	}
	const claimed = claimLease(file, lease);
	if (!claimed.ok) return claimed;

	const release = (error: SessionError): Result<Worktree, SessionError> => {
		dropLease(file);
		return { ok: false, error };
	};

	const taken = await branchExists(port, top, branch);
	if (!taken.ok) return release(taken.error);
	if (taken.value) {
		return release({
			code: "in_use",
			message: `branch ${branch} survives from an earlier run of ${runId}; clean it up or use another run id`,
		});
	}

	const added = await withWorktreeLock(commonDir, processes, () =>
		gitOk(port, top, [
			"worktree",
			"add",
			"--quiet",
			"-b",
			branch,
			path,
			lease.baseSha,
		]),
	);
	if (!added.ok) return release(added.error);

	return {
		ok: true,
		value: {
			runId,
			path,
			branch,
			baseSha: lease.baseSha,
			baseRef: lease.baseRef,
			commonDir,
		},
	};
}
