/**
 * Root resolution (FR-INS-3).
 *
 * Decides which repository maina operates on. Sources in precedence order:
 *
 *   1. `explicit`       — a `--root` flag or equivalent
 *   2. `hostProjectDir` — the project dir the host agent reports
 *   3. `mcpRoots`       — roots an MCP client advertises (paths or file:// URIs)
 *   4. `cwd`            — the git root of the working directory
 *
 * The first source that is provided decides. Each candidate resolves to the
 * top level of the nearest enclosing git work tree, so a subdirectory, a
 * nested repository and a linked worktree each map to the right root. A
 * provided source that sits outside any repository refuses with `NoRepo`
 * instead of falling through to a lower source: maina never guesses a root,
 * and callers write nothing when resolution fails.
 *
 * A top level equal to the user's home directory (a dotfiles repository in
 * `$HOME`) or to the filesystem root is not a project: unless the source is
 * `explicit`, such a candidate counts as outside any repository, so
 * `~/scratch` refuses instead of writing state into `$HOME`. An explicit
 * `--root` is the override.
 *
 * `resolveRoot` is pure over the injected `GitProbe`; `gitProbe` is the real
 * probe, backed by `git rev-parse --show-toplevel`. `resolveRootAsync` and
 * `asyncGitProbe` are the same over an async probe, for the daemon, where a
 * blocking spawn would stall every connection.
 */

import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Result, stripRepoLocalGitEnv } from "@mainahq/core";

export type RootSource = "explicit" | "host" | "mcp" | "cwd";

export type Root = Readonly<{
	/** Absolute top level of the repository work tree. */
	path: string;
	source: RootSource;
}>;

export type NoRepo = Readonly<{
	kind: "no_repo";
	/** The source that decided resolution. */
	source: RootSource;
	/** Candidates probed, in order: absolute dirs, or the raw value of a non-local URI. */
	tried: readonly string[];
}>;

export type RootInputs = Readonly<{
	explicit?: string;
	hostProjectDir?: string;
	mcpRoots?: readonly string[];
	/** Absolute working directory; relative inputs resolve against it. */
	cwd: string;
	/**
	 * The user's home directory, spelled as git reports paths (symlinks
	 * resolved). A non-explicit root equal to it refuses. Omitted, blank or
	 * relative: no home check.
	 */
	home?: string;
}>;

/** Read-only git lookup: the work-tree top level containing `dir`, or null. */
export type GitProbe = Readonly<{
	toplevel: (dir: string) => string | null;
}>;

type Candidates = Readonly<{ source: RootSource; values: readonly string[] }>;

const provided = (value: string | undefined): value is string =>
	value !== undefined && value.trim() !== "";

/** A URI scheme of two or more chars, so a Windows drive letter is not one. */
const URI_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Local path for a `file:` URI with no host (URL parsing folds `localhost` to
 * ""); null for any other URI. The host check comes before `fileURLToPath`,
 * which would otherwise turn `file://host/...` into a UNC path on Windows.
 */
const fileUriToDir = (value: string): string | null => {
	try {
		const url = new URL(value);
		if (url.protocol !== "file:" || url.hostname !== "") return null;
		return fileURLToPath(url);
	} catch {
		return null;
	}
};

/**
 * Absolute dir for a path or file: URI; null for a URI that names no local
 * path, or for a relative value when `cwd` is itself relative (resolving it
 * would silently depend on the process working directory).
 */
const toDir = (value: string, cwd: string): string | null => {
	if (URI_SCHEME.test(value)) return fileUriToDir(value);
	if (isAbsolute(value)) return resolve(value);
	return isAbsolute(cwd) ? resolve(cwd, value) : null;
};

/** The highest-precedence source that was provided, with its raw values. */
const pickCandidates = (inputs: RootInputs): Candidates => {
	const { explicit, hostProjectDir, cwd } = inputs;
	if (provided(explicit)) return { source: "explicit", values: [explicit] };
	if (provided(hostProjectDir)) {
		return { source: "host", values: [hostProjectDir] };
	}
	const mcpRoots = (inputs.mcpRoots ?? []).filter(provided);
	if (mcpRoots.length > 0) return { source: "mcp", values: mcpRoots };
	return { source: "cwd", values: [cwd] };
};

/**
 * Whether a git top level is one only an explicit root may choose: a
 * filesystem root (any drive root on Windows, not only the current drive, so
 * the answer never depends on the process working directory), or the home
 * directory when an absolute one is given.
 */
const isReserved = (path: string, home: string | undefined): boolean => {
	const top = resolve(path);
	if (dirname(top) === top) return true;
	return provided(home) && isAbsolute(home) && top === resolve(home);
};

export function resolveRoot(
	inputs: RootInputs,
	git: GitProbe,
): Result<Root, NoRepo> {
	const { source, values } = pickCandidates(inputs);
	const tried: string[] = [];
	for (const value of values) {
		const dir = toDir(value, inputs.cwd);
		const path = dir === null ? null : git.toplevel(dir);
		const allowed =
			path !== null &&
			(source === "explicit" || !isReserved(path, inputs.home));
		if (allowed) {
			return { ok: true, value: { path, source } };
		}
		tried.push(dir ?? value);
	}
	return { ok: false, error: { kind: "no_repo", source, tried } };
}

/** An async `GitProbe`, for callers that must not block the event loop. */
type AsyncGitProbe = Readonly<{
	toplevel: (dir: string) => Promise<string | null>;
}>;

/** `resolveRoot` over an async probe: the same precedence and refusals. */
export async function resolveRootAsync(
	inputs: RootInputs,
	git: AsyncGitProbe,
): Promise<Result<Root, NoRepo>> {
	const { source, values } = pickCandidates(inputs);
	const tried: string[] = [];
	for (const value of values) {
		const dir = toDir(value, inputs.cwd);
		const path = dir === null ? null : await git.toplevel(dir);
		const allowed =
			path !== null &&
			(source === "explicit" || !isReserved(path, inputs.home));
		if (allowed) {
			return { ok: true, value: { path, source } };
		}
		tried.push(dir ?? value);
	}
	return { ok: false, error: { kind: "no_repo", source, tried } };
}

/**
 * `parent` without the variables that point git at a specific repository
 * regardless of the directory it runs in (set, for example, inside git
 * hooks): core's repo-local `GIT_*` list, the one its process adapter drops
 * (`git rev-parse --local-env-vars`). The probe answer then depends only on
 * `dir`. Discovery limits such as `GIT_CEILING_DIRECTORIES` are the user's
 * own policy and only narrow the search, so they are kept: honouring them
 * can refuse, never widen.
 */
export const probeEnv = (
	parent: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> => ({ ...stripRepoLocalGitEnv(parent) });

const TOPLEVEL = ["git", "rev-parse", "--show-toplevel"];

const probeOptions = (dir: string) =>
	({
		cwd: dir,
		env: probeEnv(process.env),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	}) as const;

const toplevelOf = (exitCode: number | null, stdout: string): string | null => {
	if (exitCode !== 0) return null;
	const top = stdout.trim();
	return top === "" ? null : top;
};

/** Real probe: `git rev-parse --show-toplevel` run in `dir`. Never writes. */
export const gitProbe: GitProbe = {
	toplevel: (dir) => {
		try {
			const proc = Bun.spawnSync(TOPLEVEL, probeOptions(dir));
			return toplevelOf(proc.exitCode, proc.stdout.toString());
		} catch {
			// Missing or unreadable dir: not inside a repository.
			return null;
		}
	},
};

/** `gitProbe` without blocking: the same command, awaited. Never rejects. */
export const asyncGitProbe: AsyncGitProbe = {
	toplevel: async (dir) => {
		try {
			const proc = Bun.spawn(TOPLEVEL, probeOptions(dir));
			const [stdout, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				proc.exited,
			]);
			return toplevelOf(exitCode, stdout);
		} catch {
			// Missing or unreadable dir: not inside a repository.
			return null;
		}
	},
};

/**
 * `symbolic-ref`, not `rev-parse --abbrev-ref`: it also names the branch of
 * a repository with no commits yet, and fails on a detached HEAD instead of
 * printing `HEAD`. The full ref, not `--short`: a tag of the same name
 * would shorten it to `heads/<branch>`, which no protected branch matches.
 */
const BRANCH = ["git", "symbolic-ref", "--quiet", "HEAD"];
const HEADS = "refs/heads/";

/**
 * The branch checked out in `dir`, or null for a detached HEAD or a
 * directory outside any repository. Read-only; never rejects.
 */
export async function checkedOutBranch(dir: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(BRANCH, probeOptions(dir));
		const [stdout, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		const ref = stdout.trim();
		if (exitCode !== 0 || !ref.startsWith(HEADS)) return null;
		const branch = ref.slice(HEADS.length);
		return branch === "" ? null : branch;
	} catch {
		// Missing or unreadable dir: no branch.
		return null;
	}
}
