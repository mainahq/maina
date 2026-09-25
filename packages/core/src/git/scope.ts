/**
 * Verify scope resolution (#328, FR-VER-1): which changed files a verify run
 * looks at.
 *
 *   working-tree  everything that differs from the merge-base with the base
 *                 branch: committed on the branch, staged, unstaged, plus
 *                 untracked files (the default)
 *   staged        the index only (the pre-#328 behaviour, `--staged`)
 *   range         what the branch committed since the base (`base...HEAD`)
 *
 * Deleted paths are dropped (`--diff-filter=d`): no tool can check a file
 * that is gone. The staged scope keeps the old list exactly.
 */

import type { GitPort } from "../ports/git";
import { systemProcess } from "../process/index";
import { createProcessGit, getMergeBase, getStagedFiles } from "./index";

export type ScopeKind = "working-tree" | "staged" | "range";

interface ScopeOptions {
	readonly cwd: string;
	/** Resolved base ref (see `resolveBaseBranch`). */
	readonly base: string;
	readonly git?: GitPort;
}

const systemGit: GitPort = createProcessGit(systemProcess);

const lines = (stdout: string): string[] =>
	stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

/** Lines of `git <args>` stdout, or `undefined` when git fails. */
async function list(
	git: GitPort,
	cwd: string,
	args: readonly string[],
): Promise<string[] | undefined> {
	const result = await git.run(cwd, args);
	return result.ok ? lines(result.value) : undefined;
}

const unique = (paths: readonly string[]): string[] => [...new Set(paths)];

/** Untracked files that are not ignored (`.gitignore`, exclude files). */
export async function getUntrackedFiles(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string[]> {
	return (
		(await list(git, cwd, ["ls-files", "--others", "--exclude-standard"])) ?? []
	);
}

async function workingTreeFiles(
	cwd: string,
	base: string,
	git: GitPort,
): Promise<string[]> {
	const mergeBase = await getMergeBase(base, cwd, git);
	const vsBase = await list(git, cwd, [
		"diff",
		"--name-only",
		"--diff-filter=d",
		mergeBase,
	]);
	// No usable base (e.g. before the first commit): index + worktree.
	const tracked =
		vsBase ??
		unique([
			...((await list(git, cwd, [
				"diff",
				"--cached",
				"--name-only",
				"--diff-filter=d",
			])) ?? []),
			...((await list(git, cwd, ["diff", "--name-only", "--diff-filter=d"])) ??
				[]),
		]);
	return unique([...tracked, ...(await getUntrackedFiles(cwd, git))]);
}

/** The changed files in `kind` scope, relative to the repository root. */
export async function resolveScopeFiles(
	kind: ScopeKind,
	options: ScopeOptions,
): Promise<string[]> {
	const git = options.git ?? systemGit;
	switch (kind) {
		case "staged":
			return getStagedFiles(options.cwd, git);
		case "range":
			return (
				(await list(git, options.cwd, [
					"diff",
					"--name-only",
					"--diff-filter=d",
					`${options.base}...HEAD`,
				])) ?? []
			);
		case "working-tree":
			return workingTreeFiles(options.cwd, options.base, git);
		default: {
			const unreachable: never = kind;
			return unreachable;
		}
	}
}
