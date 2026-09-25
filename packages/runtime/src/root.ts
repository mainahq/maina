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
 * `resolveRoot` is pure over the injected `GitProbe`; `gitProbe` is the real
 * probe, backed by `git rev-parse --show-toplevel`.
 */

import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "@mainahq/core";

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

/** Absolute dir for a path or file: URI; null for a URI that names no local path. */
const toDir = (value: string, cwd: string): string | null => {
	if (URI_SCHEME.test(value)) {
		if (!value.startsWith("file:")) return null;
		try {
			return fileURLToPath(value);
		} catch {
			return null;
		}
	}
	return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
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

export function resolveRoot(
	inputs: RootInputs,
	git: GitProbe,
): Result<Root, NoRepo> {
	const { source, values } = pickCandidates(inputs);
	const tried: string[] = [];
	for (const value of values) {
		const dir = toDir(value, inputs.cwd);
		const path = dir === null ? null : git.toplevel(dir);
		if (path !== null) return { ok: true, value: { path, source } };
		tried.push(dir ?? value);
	}
	return { ok: false, error: { kind: "no_repo", source, tried } };
}

/**
 * Variables that point git at a specific repository regardless of the
 * directory it runs in (set, for example, inside git hooks). The probe drops
 * them so the answer depends only on `dir`.
 */
const REPO_LOCATING_ENV = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_PREFIX",
] as const;

const probeEnv = (): Record<string, string | undefined> => {
	const env: Record<string, string | undefined> = { ...process.env };
	for (const key of REPO_LOCATING_ENV) delete env[key];
	return env;
};

/** Real probe: `git rev-parse --show-toplevel` run in `dir`. Never writes. */
export const gitProbe: GitProbe = {
	toplevel: (dir) => {
		try {
			const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
				cwd: dir,
				env: probeEnv(),
				stdin: "ignore",
				stdout: "pipe",
				stderr: "ignore",
			});
			if (proc.exitCode !== 0) return null;
			const top = proc.stdout.toString().trim();
			return top === "" ? null : top;
		} catch {
			// Missing or unreadable dir: not inside a repository.
			return null;
		}
	},
};
