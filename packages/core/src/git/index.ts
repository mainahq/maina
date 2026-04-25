export interface Commit {
	hash: string;
	message: string;
	author: string;
	date: string;
}

async function exec(
	args: string[],
	cwd: string = process.cwd(),
): Promise<string> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			// Force English git output so locale-aware parsers (e.g.
			// parseShortstat's "files changed / insertions / deletions"
			// regexes) work on contributor machines that aren't en_US.
			env: { ...process.env, LC_ALL: "C", LANG: "C" },
		});
		const output = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;
		if (exitCode !== 0) return "";
		return output.trim();
	} catch {
		return "";
	}
}

export async function getCurrentBranch(cwd?: string): Promise<string> {
	const branch = await exec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	return branch;
}

export async function getBranchName(cwd?: string): Promise<string> {
	return getCurrentBranch(cwd);
}

export async function getRepoRoot(cwd?: string): Promise<string> {
	const root = await exec(["rev-parse", "--show-toplevel"], cwd);
	return root;
}

export async function getRecentCommits(
	n: number,
	cwd?: string,
): Promise<Commit[]> {
	const separator = "|||";
	const format = `%H${separator}%s${separator}%an${separator}%ai`;
	const output = await exec(["log", `-${n}`, `--pretty=format:${format}`], cwd);
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

export async function getChangedFiles(
	since?: string,
	cwd?: string,
): Promise<string[]> {
	let output: string;
	if (since) {
		output = await exec(["diff", "--name-only", since], cwd);
	} else {
		output = await exec(["status", "--porcelain"], cwd);
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
	ref1?: string,
	ref2?: string,
	cwd?: string,
): Promise<string> {
	const args: string[] = ["diff"];
	if (ref1 && ref2) {
		args.push(ref1, ref2);
	} else if (ref1) {
		args.push(ref1);
	}
	const output = await exec(args, cwd);
	return output;
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

export interface GetDiffStatsOptions {
	/** Range start (e.g. `<commit>^`). Use with `to` for an arbitrary range. */
	from?: string;
	/** Range end. */
	to?: string;
	/** Use `--cached` (staged diff). Ignored when `from`/`to` are set. */
	staged?: boolean;
	/** Optional pathspec to scope the stats to a specific file list. */
	files?: string[];
	cwd?: string;
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
	options: GetDiffStatsOptions = {},
): Promise<DiffStats> {
	const partialRange =
		(options.from && !options.to) || (!options.from && options.to);
	if (partialRange) return { additions: 0, deletions: 0, files: 0 };

	const args = ["diff", "--shortstat"];
	if (options.from && options.to) {
		args.push(`${options.from}..${options.to}`);
	} else if (options.staged) {
		args.push("--cached");
	}
	if (options.files && options.files.length > 0) {
		args.push("--", ...options.files);
	}
	const output = await exec(args, options.cwd);
	return parseShortstat(output);
}

export async function getStagedFiles(cwd?: string): Promise<string[]> {
	const output = await exec(["diff", "--cached", "--name-only"], cwd);
	if (!output) return [];
	return output.split("\n").filter((line) => line.trim().length > 0);
}

export async function getTrackedFiles(cwd?: string): Promise<string[]> {
	const output = await exec(
		["ls-files", "--cached", "--exclude-standard"],
		cwd,
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
export async function getRepoSlug(cwd?: string): Promise<string> {
	const url = await exec(["remote", "get-url", "origin"], cwd);
	if (url) {
		// SSH: git@github.com:owner/repo.git
		const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
		if (sshMatch?.[1]) return sshMatch[1];
		// HTTPS: https://github.com/owner/repo.git
		const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
		if (httpsMatch?.[1]) return httpsMatch[1];
	}
	// Fallback: use directory name
	const root = await exec(["rev-parse", "--show-toplevel"], cwd);
	if (root) {
		const parts = root.split("/");
		return parts[parts.length - 1] ?? "unknown";
	}
	return "unknown";
}
