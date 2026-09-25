import type { GitPort } from "../ports/git";

export interface Commit {
	hash: string;
	message: string;
	author: string;
	date: string;
}

/**
 * The real `GitPort`: the one place in core that spawns the git binary.
 * Every function below takes the repository root explicitly and an optional
 * `git` port (this adapter by default; tests pass the in-memory fake). The
 * child inherits the parent environment. Never rejects: spawn failures and
 * non-zero exits come back as a `GitError`.
 */
const systemGit: GitPort = {
	run: async (root, args) => {
		try {
			const proc = Bun.spawn(["git", ...args], {
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			return exitCode === 0
				? { ok: true, value: stdout }
				: { ok: false, error: { kind: "failed", exitCode, stderr } };
		} catch (e) {
			return {
				ok: false,
				error: {
					kind: "failed",
					exitCode: -1,
					stderr: e instanceof Error ? e.message : String(e),
				},
			};
		}
	},
};

/** Trimmed stdout of `git <args>` run in `cwd`, or "" when git fails. */
async function exec(
	args: readonly string[],
	cwd: string,
	git: GitPort,
): Promise<string> {
	const result = await git.run(cwd, args);
	return result.ok ? result.value.trim() : "";
}

export async function getCurrentBranch(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	return exec(["rev-parse", "--abbrev-ref", "HEAD"], cwd, git);
}

export async function getBranchName(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	return getCurrentBranch(cwd, git);
}

export async function getRepoRoot(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	return exec(["rev-parse", "--show-toplevel"], cwd, git);
}

export async function getRecentCommits(
	n: number,
	cwd: string,
	git: GitPort = systemGit,
): Promise<Commit[]> {
	const separator = "|||";
	const format = `%H${separator}%s${separator}%an${separator}%ai`;
	const output = await exec(
		["log", `-${n}`, `--pretty=format:${format}`],
		cwd,
		git,
	);
	if (!output) return [];
	return output
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => {
			const parts = line.split(separator);
			return {
				hash: parts[0]?.trim() ?? "",
				message: parts[1]?.trim() ?? "",
				author: parts[2]?.trim() ?? "",
				date: parts[3]?.trim() ?? "",
			};
		});
}

/** Full message (subject + body + trailers) of the HEAD commit, or "". */
export async function getHeadCommitMessage(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	return exec(["log", "-1", "--pretty=format:%B"], cwd, git);
}

export async function getChangedFiles(
	since: string | undefined,
	cwd: string,
	git: GitPort = systemGit,
): Promise<string[]> {
	let output: string;
	if (since) {
		output = await exec(["diff", "--name-only", since], cwd, git);
	} else {
		output = await exec(["status", "--porcelain"], cwd, git);
		if (!output) return [];
		return output
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => line.slice(3).trim());
	}
	if (!output) return [];
	return output.split("\n").filter((line) => line.trim().length > 0);
}

export async function getDiff(
	ref1: string | undefined,
	ref2: string | undefined,
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	const args: string[] = ["diff"];
	if (ref1 && ref2) {
		args.push(ref1, ref2);
	} else if (ref1) {
		args.push(ref1);
	}
	return exec(args, cwd, git);
}

const refExists = async (
	ref: string,
	cwd: string,
	git: GitPort,
): Promise<boolean> =>
	(await exec(
		["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
		cwd,
		git,
	)) !== "";

/**
 * Resolve the branch to diff against. Precedence: `preferred` exactly as
 * given (local first) → origin/HEAD → master → main, where defaults prefer
 * `origin/<name>` over a possibly stale local branch → "HEAD".
 * Never assumes "main": master-based repos made `git diff main` fail and the
 * diff filter fall open (#364).
 */
export async function resolveBaseBranch(
	cwd: string,
	preferred?: string,
	git: GitPort = systemGit,
): Promise<string> {
	const withRemote = (name: string, localFirst: boolean): string[] => {
		if (name.startsWith("origin/")) return [name];
		return localFirst ? [name, `origin/${name}`] : [`origin/${name}`, name];
	};
	const originHead = (
		await exec(
			["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
			cwd,
			git,
		)
	).replace(/^origin\//, "");
	const candidates = [
		...(preferred ? withRemote(preferred, true) : []),
		...[originHead, "master", "main"]
			.filter((n) => n.length > 0)
			.flatMap((n) => withRemote(n, false)),
	];
	for (const ref of candidates) {
		if (await refExists(ref, cwd, git)) return ref;
	}
	return "HEAD";
}

/** Staged changes vs HEAD (or vs the empty tree before the first commit). */
export async function getStagedDiff(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	return exec(["diff", "--cached"], cwd, git);
}

/** Merge-base of `base` and HEAD, or `base` itself when there is none. */
export async function getMergeBase(
	base: string,
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	return (await exec(["merge-base", base, "HEAD"], cwd, git)) || base;
}

export interface DiffStats {
	additions: number;
	deletions: number;
	files: number;
}

/**
 * Parse a `git diff --shortstat` line. Output forms:
 *   ""                                              → all zero
 *   " 1 file changed, 1 insertion(+)"               → add-only
 *   " 2 files changed, 7 deletions(-)"              → del-only
 *   " 3 files changed, 42 insertions(+), 5 deletions(-)"
 *
 * The shortstat wording is localised by git, so this only parses output from
 * an English (or `LC_ALL=C`) git; `getDiffStats` uses `parseNumstat`.
 */
export function parseShortstat(output: string): DiffStats {
	if (!output.trim()) return { additions: 0, deletions: 0, files: 0 };
	const filesMatch = output.match(/(\d+) files? changed/);
	const addMatch = output.match(/(\d+) insertions?\(\+\)/);
	const delMatch = output.match(/(\d+) deletions?\(-\)/);
	return {
		files: filesMatch?.[1] ? Number.parseInt(filesMatch[1], 10) : 0,
		additions: addMatch?.[1] ? Number.parseInt(addMatch[1], 10) : 0,
		deletions: delMatch?.[1] ? Number.parseInt(delMatch[1], 10) : 0,
	};
}

/**
 * Sum `git diff --numstat` output: one `<added>\t<deleted>\t<path>` line
 * per file, with `-` for both counts on binary files (counted as a changed
 * file with no lines). Unlike `--shortstat` it is never localised, so the
 * stats are right whatever the contributor's locale.
 */
export function parseNumstat(output: string): DiffStats {
	const count = (field: string | undefined): number => {
		const n = Number.parseInt(field ?? "", 10);
		return Number.isNaN(n) ? 0 : n;
	};
	return output
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.reduce<DiffStats>(
			(acc, line) => {
				const [added, deleted] = line.split("\t");
				return {
					files: acc.files + 1,
					additions: acc.additions + count(added),
					deletions: acc.deletions + count(deleted),
				};
			},
			{ additions: 0, deletions: 0, files: 0 },
		);
}

export interface GetDiffStatsOptions {
	/** Range start (e.g. `<commit>^`). Use with `to` for an arbitrary range. */
	from?: string;
	/** Range end. */
	to?: string;
	/** Use `--cached` (staged diff). Ignored when `from`/`to` are set. */
	staged?: boolean;
	/** Optional pathspec to scope the stats to a specific file list. */
	files?: string[];
	/** Repository root the diff runs in. */
	cwd: string;
	/** Git port; defaults to the real git binary. */
	git?: GitPort;
}

/**
 * Compute diff stats. Falls back to zero on git failure (matches the rest
 * of this module's never-throw pattern).
 *
 * `from` and `to` must be supplied together — supplying only one is a
 * caller bug (the other "default" git would pick is rarely the range the
 * caller meant). Returns zero in that case rather than silently producing
 * misleading stats.
 */
export async function getDiffStats(
	options: GetDiffStatsOptions,
): Promise<DiffStats> {
	const partialRange =
		(options.from && !options.to) || (!options.from && options.to);
	if (partialRange) return { additions: 0, deletions: 0, files: 0 };

	const args = ["diff", "--numstat"];
	if (options.from && options.to) {
		args.push(`${options.from}..${options.to}`);
	} else if (options.staged) {
		args.push("--cached");
	}
	if (options.files && options.files.length > 0) {
		args.push("--", ...options.files);
	}
	const output = await exec(args, options.cwd, options.git ?? systemGit);
	return parseNumstat(output);
}

export async function getStagedFiles(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string[]> {
	const output = await exec(["diff", "--cached", "--name-only"], cwd, git);
	if (!output) return [];
	return output.split("\n").filter((line) => line.trim().length > 0);
}

export async function getTrackedFiles(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string[]> {
	const output = await exec(
		["ls-files", "--cached", "--exclude-standard"],
		cwd,
		git,
	);
	if (!output) return [];
	return output.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * Extract the "owner/repo" slug from the git remote origin URL.
 * Handles HTTPS (https://github.com/owner/repo.git) and
 * SSH (git@github.com:owner/repo.git) formats.
 * Returns the directory basename as fallback if parsing fails.
 */
export async function getRepoSlug(
	cwd: string,
	git: GitPort = systemGit,
): Promise<string> {
	const url = await exec(["remote", "get-url", "origin"], cwd, git);
	if (url) {
		// SSH: git@github.com:owner/repo.git
		const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
		if (sshMatch?.[1]) return sshMatch[1];
		// HTTPS: https://github.com/owner/repo.git
		const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
		if (httpsMatch?.[1]) return httpsMatch[1];
	}
	// Fallback: use directory name
	const root = await exec(["rev-parse", "--show-toplevel"], cwd, git);
	if (root) {
		const parts = root.split("/");
		return parts[parts.length - 1] ?? "unknown";
	}
	return "unknown";
}
