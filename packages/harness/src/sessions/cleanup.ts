/**
 * Ending a run without losing its work (FR-HAR-6).
 *
 * `cleanup(runId, { root })` stops the run's PTYs, frees its checkout and
 * drops its lease. It never deletes commits that are not merged unless the
 * caller says `keepUnmerged: false`:
 *
 *   - uncommitted changes (untracked files included) are first committed to
 *     the run's branch, so they become commits like any other;
 *   - the branch is deleted only when its tip is already in the base branch
 *     the run started from (the recorded base commit if that branch is
 *     gone), otherwise it is kept and the outcome says `kept: "unmerged"`;
 *   - a checkout whose HEAD left the run's branch (detached, or on another
 *     branch) is kept whole, since removing it could strand commits that no
 *     branch holds: `kept: "head_moved"`.
 *
 * A run whose owner is still alive belongs to that owner: only the owner
 * itself may clean it up. `reclaim(root)` is the crash path: it cleans up
 * every run whose owner process is gone, with the same rules.
 */

import { existsSync } from "node:fs";
import type { Result } from "@mainahq/core";
import {
	dropLease,
	type Lease,
	type LeaseFile,
	listLeases,
	loadLease,
	type SessionError,
	validateRunId,
	withWorktreeLock,
} from "./lease";
import { liveness, stopGroup } from "./processes";
import {
	branchExists,
	findRepo,
	git,
	gitOk,
	type Repo,
	resolveDeps,
	type SessionDeps,
} from "./worktree";

export type CleanupOptions = Readonly<{
	/** Any directory inside the repository the run belongs to. */
	root: string;
	/** Keep a branch with unmerged commits. Only an explicit `false` deletes it. */
	keepUnmerged?: boolean;
	/** How long each PTY gets between SIGTERM and SIGKILL. */
	graceMs?: number;
	deps?: Partial<SessionDeps>;
}>;

export type KeptReason = "unmerged" | "head_moved";

export type CleanupOutcome = Readonly<{
	runId: string;
	branch: string;
	/** The checkout is gone. */
	worktreeRemoved: boolean;
	branchDeleted: boolean;
	/** Uncommitted work was committed to the branch first. */
	salvaged: boolean;
	/** Why something was kept, when it was. */
	kept?: KeptReason;
	/** The PTY pids that were stopped. */
	stopped: readonly number[];
}>;

export type ReclaimReport = Readonly<{
	/** Runs of crashed owners, now cleaned up. */
	reclaimed: readonly CleanupOutcome[];
	/** Runs whose owner still runs (or cannot be told apart from one that does). */
	live: readonly string[];
	failed: readonly Readonly<{ runId: string; error: SessionError }>[];
}>;

const DEFAULT_GRACE_MS = 2000;

/** The harness's name on salvage commits. */
const SALVAGE_IDENTITY = [
	"-c",
	"user.name=maina harness",
	"-c",
	"user.email=harness@maina.invalid",
];

type Release = Readonly<{
	repo: Repo;
	loaded: LeaseFile;
	keepUnmerged: boolean;
	graceMs: number;
	deps: SessionDeps;
}>;

/** Commits whatever is uncommitted in the checkout to its branch; true when there was something to commit. */
async function salvage(
	deps: SessionDeps,
	lease: Lease,
): Promise<Result<boolean, SessionError>> {
	const { git: port } = deps;
	const status = await gitOk(port, lease.path, [
		"status",
		"--porcelain",
		"--untracked-files=all",
	]);
	if (!status.ok) return status;
	if (status.value === "") return { ok: true, value: false };

	// Plumbing, not `git commit`: no hooks run, and only the run's branch moves.
	const added = await gitOk(port, lease.path, ["add", "-A"]);
	if (!added.ok) return added;
	const tree = await gitOk(port, lease.path, ["write-tree"]);
	if (!tree.ok) return tree;
	const parent = await gitOk(port, lease.path, ["rev-parse", "HEAD"]);
	if (!parent.ok) return parent;
	const commit = await gitOk(port, lease.path, [
		...SALVAGE_IDENTITY,
		"commit-tree",
		tree.value,
		"-p",
		parent.value,
		"-m",
		`maina: salvage uncommitted work from run ${lease.runId}`,
	]);
	if (!commit.ok) return commit;
	const moved = await gitOk(port, lease.path, [
		"update-ref",
		`refs/heads/${lease.branch}`,
		commit.value,
		parent.value,
	]);
	return moved.ok ? { ok: true, value: true } : moved;
}

/** Whether the run's branch tip is already in the base it started from. */
async function merged(
	deps: SessionDeps,
	repo: Repo,
	lease: Lease,
): Promise<Result<boolean, SessionError>> {
	const baseAlive =
		lease.baseRef === null
			? ({ ok: true, value: false } as const)
			: await branchExists(deps.git, repo.top, lease.baseRef);
	if (!baseAlive.ok) return baseAlive;
	const base =
		baseAlive.value && lease.baseRef !== null
			? `refs/heads/${lease.baseRef}`
			: lease.baseSha;
	const ran = await git(deps.git, repo.top, [
		"merge-base",
		"--is-ancestor",
		`refs/heads/${lease.branch}`,
		base,
	]);
	if (!ran.ok) return ran;
	if (ran.value.code === 0 || ran.value.code === 1) {
		return { ok: true, value: ran.value.code === 0 };
	}
	return {
		ok: false,
		error: {
			code: "git_failed",
			message: `cannot tell whether ${lease.branch} is merged: ${ran.value.stderr}`,
		},
	};
}

/** Whether the checkout is still a worktree git knows, and on the run's branch. */
async function checkoutState(
	deps: SessionDeps,
	repo: Repo,
	lease: Lease,
): Promise<Result<"missing" | "on_branch" | "moved", SessionError>> {
	const list = await withWorktreeLock(repo.commonDir, deps.processes, () =>
		gitOk(deps.git, repo.top, ["worktree", "list", "--porcelain"]),
	);
	if (!list.ok) return list;
	const entry = list.value
		.split("\n\n")
		.find((block) => block.split("\n")[0] === `worktree ${lease.path}`);
	// Gone from disk (deleted by hand) counts as missing: `prune` tidies it.
	if (entry === undefined || !existsSync(lease.path)) {
		return { ok: true, value: "missing" };
	}
	return {
		ok: true,
		value: entry.split("\n").includes(`branch refs/heads/${lease.branch}`)
			? "on_branch"
			: "moved",
	};
}

async function release(
	r: Release,
): Promise<Result<CleanupOutcome, SessionError>> {
	const { repo, loaded, keepUnmerged, graceMs, deps } = r;
	const { lease, file } = loaded;
	const port = deps.git;

	const stopped: number[] = [];
	for (const pty of lease.ptys) {
		if (await stopGroup(deps.processes, pty, graceMs)) stopped.push(pty.pid);
	}

	const state = await checkoutState(deps, repo, lease);
	if (!state.ok) return state;

	const base = {
		runId: lease.runId,
		branch: lease.branch,
		stopped,
	};

	if (state.value === "moved" && keepUnmerged) {
		// The lease stays, so the run can be found and cleaned up later.
		return {
			ok: true,
			value: {
				...base,
				worktreeRemoved: false,
				branchDeleted: false,
				salvaged: false,
				kept: "head_moved",
			},
		};
	}

	let salvaged = false;
	if (state.value === "on_branch" && keepUnmerged) {
		const saved = await salvage(deps, lease);
		if (!saved.ok) return saved;
		salvaged = saved.value;
	}

	const removed = await withWorktreeLock(repo.commonDir, deps.processes, () =>
		gitOk(
			port,
			repo.top,
			state.value === "missing"
				? ["worktree", "prune"]
				: ["worktree", "remove", "--force", "--force", lease.path],
		),
	);
	if (!removed.ok) return removed;

	const exists = await branchExists(port, repo.top, lease.branch);
	if (!exists.ok) return exists;
	let branchDeleted = false;
	let kept: KeptReason | undefined;
	if (exists.value) {
		const isMerged = keepUnmerged
			? await merged(deps, repo, lease)
			: ({ ok: true, value: false } as const);
		if (!isMerged.ok) return isMerged;
		if (isMerged.value || !keepUnmerged) {
			const deleted = await gitOk(port, repo.top, [
				"branch",
				"-D",
				lease.branch,
			]);
			if (!deleted.ok) return deleted;
			branchDeleted = true;
		} else {
			kept = "unmerged";
		}
	}

	dropLease(file);
	return {
		ok: true,
		value: {
			...base,
			worktreeRemoved: true,
			branchDeleted,
			salvaged,
			...(kept === undefined ? {} : { kept }),
		},
	};
}

/**
 * Ends run `runId`: stops its PTYs, commits its uncommitted work to its
 * branch, removes its checkout, and deletes its branch only if merged (or
 * if `keepUnmerged: false`). Fails with `in_use` while another live process
 * owns the run.
 */
export async function cleanup(
	runId: string,
	options: CleanupOptions,
): Promise<Result<CleanupOutcome, SessionError>> {
	const id = validateRunId(runId);
	if (!id.ok) return id;
	const deps = resolveDeps(options.deps);
	const repo = await findRepo(deps.git, options.root);
	if (!repo.ok) return repo;
	const loaded = loadLease(repo.value.commonDir, runId);
	if (!loaded.ok) return loaded;

	const { owner } = loaded.value.lease;
	if (
		owner.pid !== deps.processes.self &&
		liveness(deps.processes, owner) !== "gone"
	) {
		return {
			ok: false,
			error: {
				code: "in_use",
				message: `run ${runId} is owned by live process ${owner.pid}`,
			},
		};
	}

	return release({
		repo: repo.value,
		loaded: loaded.value,
		keepUnmerged: options.keepUnmerged !== false,
		graceMs: options.graceMs ?? DEFAULT_GRACE_MS,
		deps,
	});
}

/**
 * Cleans up every run whose owner has crashed: its PTYs are stopped and its
 * checkout freed, with its work kept on its branch. Runs with a live owner
 * are listed and left alone.
 */
export async function reclaim(
	root: string,
	options: Readonly<{ graceMs?: number; deps?: Partial<SessionDeps> }> = {},
): Promise<Result<ReclaimReport, SessionError>> {
	const deps = resolveDeps(options.deps);
	const repo = await findRepo(deps.git, root);
	if (!repo.ok) return repo;

	const reclaimed: CleanupOutcome[] = [];
	const live: string[] = [];
	const failed: { runId: string; error: SessionError }[] = [];
	for (const runId of listLeases(repo.value.commonDir)) {
		const loaded = loadLease(repo.value.commonDir, runId);
		if (!loaded.ok) {
			failed.push({ runId, error: loaded.error });
			continue;
		}
		// Not a pid comparison: a restarted process may reuse its crashed
		// predecessor's pid, and only the start time tells them apart.
		if (liveness(deps.processes, loaded.value.lease.owner) !== "gone") {
			live.push(runId);
			continue;
		}
		const released = await release({
			repo: repo.value,
			loaded: loaded.value,
			keepUnmerged: true,
			graceMs: options.graceMs ?? DEFAULT_GRACE_MS,
			deps,
		});
		if (released.ok) reclaimed.push(released.value);
		else failed.push({ runId, error: released.error });
	}
	return { ok: true, value: { reclaimed, live, failed } };
}
