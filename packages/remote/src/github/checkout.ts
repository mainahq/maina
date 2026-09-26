/**
 * Ephemeral workspaces for GitHub App jobs (FR-REM-3).
 *
 * `inEphemeralWorkspace` gives a job a fresh directory with the PR checked
 * out and deletes it afterwards, whether the job succeeded, failed or
 * threw. The deletion is verified: a directory still present afterwards is
 * a `cleanup_failed` error that replaces the job's result, so a leaked
 * checkout of someone's code is never reported as a success.
 *
 * `systemWorkspaces` is the real `Workspaces` port: a `maina-job-*`
 * directory under a temp root, filled by `git fetch` of exactly the PR's
 * head and base commits. The installation token reaches git through its
 * environment, never argv or the workspace's config.
 */

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type ProcessEnv,
	type ProcessPort,
	type Result,
	stripRepoLocalGitEnv,
} from "@mainahq/core";

export type WorkspaceError = Readonly<{ kind: "workspace"; message: string }>;

type CleanupError = Readonly<{
	kind: "cleanup_failed";
	path: string;
	message: string;
}>;

/** Where a job's code comes from: the PR's head and the commit it diffs against. */
export type CheckoutSource = Readonly<{
	cloneUrl: string;
	/** An installation token that can read the repository. */
	token: string;
	head: string;
	base: string;
}>;

export type Workspaces = Readonly<{
	/** A new, empty, private directory. */
	create: () => Promise<Result<string, WorkspaceError>>;
	/** Fetch `head` and `base` into `dir` and check `head` out. */
	checkout: (
		dir: string,
		source: CheckoutSource,
	) => Promise<Result<void, WorkspaceError>>;
	remove: (dir: string) => Promise<Result<void, WorkspaceError>>;
	exists: (dir: string) => Promise<boolean>;
}>;

/** The directory a job ran in, confirmed gone. */
export type RemovedWorkspace = Readonly<{ path: string; removed: true }>;

const workspaceError = (message: string): Result<never, WorkspaceError> => ({
	ok: false,
	error: { kind: "workspace", message },
});

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

/** A directory's lifecycle: the part of `Workspaces` that is not git. */
type Directories = Pick<Workspaces, "create" | "remove" | "exists">;

/**
 * Runs `work` in a fresh checkout of `source`, then deletes the checkout
 * and confirms it is gone.
 */
export function inEphemeralWorkspace<T, E>(
	workspaces: Workspaces,
	source: CheckoutSource,
	work: (dir: string) => Promise<Result<T, E>>,
): Promise<
	Result<
		Readonly<{ value: T; workspace: RemovedWorkspace }>,
		E | WorkspaceError | CleanupError
	>
> {
	return inRemovedDirectory(
		workspaces,
		async (dir): Promise<Result<T, E | WorkspaceError>> => {
			const checkout = await workspaces.checkout(dir, source);
			return checkout.ok ? work(dir) : checkout;
		},
	);
}

/**
 * Runs `work` in a new directory from `directories`, then deletes it and
 * confirms it is gone, whether `work` succeeded, failed or threw. A
 * directory still present afterwards is a `cleanup_failed` error that
 * replaces the result.
 */
export async function inRemovedDirectory<T, E>(
	directories: Directories,
	work: (dir: string) => Promise<Result<T, E>>,
): Promise<
	Result<
		Readonly<{ value: T; workspace: RemovedWorkspace }>,
		E | WorkspaceError | CleanupError
	>
> {
	const created = await directories.create();
	if (!created.ok) return created;
	const dir = created.value;

	let outcome: Result<T, E | WorkspaceError>;
	try {
		outcome = await work(dir);
	} catch (e) {
		outcome = workspaceError(`job failed in ${dir}: ${errorText(e)}`);
	}

	const removed = await directories
		.remove(dir)
		.catch(
			(e: unknown): Result<void, WorkspaceError> =>
				workspaceError(errorText(e)),
		);
	const remains = await directories.exists(dir).catch(() => true);
	if (!removed.ok || remains) {
		return {
			ok: false,
			error: {
				kind: "cleanup_failed",
				path: dir,
				message: removed.ok
					? "the workspace is still present after removal"
					: removed.error.message,
			},
		};
	}
	return outcome.ok
		? {
				ok: true,
				value: {
					value: outcome.value,
					workspace: { path: dir, removed: true },
				},
			}
		: outcome;
}

// ── System adapter ──────────────────────────────────────────────────────────

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const TEN_MINUTES = 10 * 60 * 1000;

function allowedCloneUrl(raw: string): boolean {
	try {
		const url = new URL(raw);
		return url.protocol === "https:" || url.protocol === "file:";
	} catch {
		return false;
	}
}

/**
 * Workspaces under `tmpRoot`, checked out with git through `process`.
 * `env` is the base environment for git (it needs `PATH`); repository-local
 * git variables are dropped from it so a caller inside a git hook cannot
 * point the fetch at its own repository.
 */
export function systemWorkspaces(
	options: Readonly<{
		process: ProcessPort;
		env: ProcessEnv;
		tmpRoot: string;
		/** Per git command; default ten minutes. */
		timeoutMs?: number;
	}>,
): Workspaces {
	const timeoutMs = options.timeoutMs ?? TEN_MINUTES;

	async function git(
		dir: string,
		args: readonly string[],
		env: ProcessEnv,
	): Promise<Result<void, WorkspaceError>> {
		const out = await options.process.spawn(["git", ...args], {
			cwd: dir,
			env,
			timeoutMs,
		});
		if (!out.ok) {
			return workspaceError(
				`git ${args[0]}: ${out.error.kind === "timeout" ? `timed out after ${out.error.timeoutMs}ms` : out.error.message}`,
			);
		}
		if (out.value.exitCode !== 0) {
			return workspaceError(`git ${args[0]}: ${out.value.stderr.trim()}`);
		}
		return { ok: true, value: undefined };
	}

	return {
		create: async () => {
			try {
				return {
					ok: true,
					value: await mkdtemp(join(options.tmpRoot, "maina-job-")),
				};
			} catch (e) {
				return workspaceError(`cannot create a workspace: ${errorText(e)}`);
			}
		},

		checkout: async (dir, source) => {
			if (!SHA.test(source.head) || !SHA.test(source.base)) {
				return workspaceError("head and base must be full commit shas");
			}
			if (!allowedCloneUrl(source.cloneUrl)) {
				return workspaceError(
					"the clone url must be https (or file, for a local mirror)",
				);
			}
			const basic = Buffer.from(`x-access-token:${source.token}`).toString(
				"base64",
			);
			const env: ProcessEnv = {
				...stripRepoLocalGitEnv(options.env),
				GIT_TERMINAL_PROMPT: "0",
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_COUNT: "2",
				GIT_CONFIG_KEY_0: "http.extraHeader",
				GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
				// A host-wide `core.hooksPath` (global config) would otherwise
				// run the host's hooks on the checkout.
				GIT_CONFIG_KEY_1: "core.hooksPath",
				GIT_CONFIG_VALUE_1: "/dev/null",
			};
			// No template either: the workspace gets no hooks from the host.
			const steps: readonly (readonly string[])[] = [
				["init", "-q", "--template=", "."],
				[
					"fetch",
					"-q",
					"--no-tags",
					"--depth=1",
					"--end-of-options",
					source.cloneUrl,
					source.head,
					source.base,
				],
				["checkout", "-q", "--detach", source.head],
			];
			for (const step of steps) {
				const done = await git(dir, step, env);
				if (!done.ok) return done;
			}
			return { ok: true, value: undefined };
		},

		remove: async (dir) => {
			try {
				await rm(dir, { recursive: true, force: true });
				return { ok: true, value: undefined };
			} catch (e) {
				return workspaceError(`cannot remove ${dir}: ${errorText(e)}`);
			}
		},

		exists: async (dir) => existsSync(dir),
	};
}
