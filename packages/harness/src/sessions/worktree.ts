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
 * Each run holds a lease (`./lease`), claimed atomically before anything
 * else exists, so two claims on one run id can never both win.
 */

import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { type ProcessPort, type Result, systemProcess } from "@mainahq/core";
import {
	claimLease,
	dropLease,
	ioError,
	type Lease,
	type LeaseFile,
	leasePath,
	leasesDir,
	loadLease,
	runBranch,
	type SessionError,
	sessionsDir,
	validateRunId,
	withWorktreeLock,
	worktreePath,
} from "./lease";
import { identify, type ProcessTable, systemProcesses } from "./processes";

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
