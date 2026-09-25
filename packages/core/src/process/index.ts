/**
 * The real `ProcessPort` (#420): the one place in core that spawns child
 * processes. Core modules take a `ProcessPort` (this adapter by default;
 * tests pass the fake from `ports/testing`), so the purity ratchet can flag
 * every other direct `Bun.spawn`.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ProcessEnv, ProcessOutput, ProcessPort } from "../ports/process";

/**
 * Variables that tie a git process to one repository, as listed by
 * `git rev-parse --local-env-vars` (git clears the same set before it
 * enters a submodule). A git hook, or any process started by `git`, exports
 * some of these for the outer repository; a child that inherits them would
 * read that repository instead of its explicit `cwd`. Transport and auth
 * variables such as `GIT_SSH_COMMAND` or `GIT_ASKPASS` are kept.
 */
const REPO_LOCAL_GIT_VARS: ReadonlySet<string> = new Set([
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_CONFIG",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_DIR",
	"GIT_GRAFT_FILE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_OBJECT_DIRECTORY",
	"GIT_PREFIX",
	"GIT_REPLACE_REF_BASE",
	"GIT_SHALLOW_FILE",
	"GIT_WORK_TREE",
]);

/**
 * `env` without git's repository-local variables. Pure. `keepIndexFile`
 * keeps `GIT_INDEX_FILE`: `git commit -a` and `git commit <path>` stage
 * into a temporary index and export its path to hooks, so a hook reading
 * its own repository must keep it or it sees the wrong staging.
 */
export function stripRepoLocalGitEnv(
	env: ProcessEnv,
	options: Readonly<{ keepIndexFile?: boolean }> = {},
): ProcessEnv {
	return Object.fromEntries(
		Object.entries(env).filter(
			([name]) =>
				!REPO_LOCAL_GIT_VARS.has(name) ||
				(name === "GIT_INDEX_FILE" && options.keepIndexFile === true),
		),
	);
}

function realpathOrUndefined(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

/**
 * The git directory of the repository containing `dir`, found the way git
 * discovers it: the nearest `.git` directory, or the directory a `.git`
 * file (linked worktree, submodule) points at.
 */
function discoverGitDir(dir: string): string | undefined {
	const dotGit = join(dir, ".git");
	const stat = statSync(dotGit, { throwIfNoEntry: false });
	if (stat?.isDirectory()) return realpathOrUndefined(dotGit);
	if (stat?.isFile()) {
		const target = /^gitdir:\s*(.+?)\s*$/m.exec(
			readFileSync(dotGit, "utf8"),
		)?.[1];
		return target === undefined
			? undefined
			: realpathOrUndefined(resolve(dir, target));
	}
	const parent = dirname(dir);
	return parent === dir ? undefined : discoverGitDir(parent);
}

/**
 * Whether an inherited `GIT_INDEX_FILE` is an index of the repository at
 * `cwd` (it sits directly in that repository's git directory, as git's own
 * `index.lock` / `next-index-*.lock` do) rather than one leaked from an
 * outer repository. A relative path never counts: it was relative to the
 * parent's working directory, not the child's.
 */
export function indexFileBelongsTo(indexFile: string, cwd: string): boolean {
	if (!isAbsolute(indexFile)) return false;
	try {
		const gitDir = discoverGitDir(resolve(cwd));
		return (
			gitDir !== undefined && realpathOrUndefined(dirname(indexFile)) === gitDir
		);
	} catch {
		return false;
	}
}

/** The parent environment minus the repo-local git variables that do not apply to `cwd`. */
function inheritedEnv(parent: ProcessEnv, cwd: string): ProcessEnv {
	const indexFile = parent.GIT_INDEX_FILE;
	return stripRepoLocalGitEnv(parent, {
		keepIndexFile:
			indexFile !== undefined && indexFileBelongsTo(indexFile, cwd),
	});
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

type Finished =
	| Readonly<{ done: "exited"; output: ProcessOutput }>
	| Readonly<{ done: "timeout"; timeoutMs: number }>;

/** How long a timed-out child gets to exit on SIGTERM before it is SIGKILLed. */
const DEFAULT_KILL_GRACE_MS = 2000;

/**
 * The system `ProcessPort`. On timeout it sends SIGTERM and, if the child
 * has not exited `killGraceMs` later, SIGKILL, so a child that traps or
 * ignores SIGTERM cannot outlive its deadline.
 */
export function createSystemProcess(
	config: Readonly<{ killGraceMs?: number }> = {},
): ProcessPort {
	const killGraceMs = config.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	return {
		spawn: async (argv, options) => {
			let proc: Bun.Subprocess<Blob | "ignore", "pipe", "pipe">;
			try {
				proc = Bun.spawn([...argv], {
					cwd: options.cwd,
					stdin:
						options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
					stdout: "pipe",
					stderr: "pipe",
					// Adapter boundary: the child inherits the parent environment
					// (minus repo-local git variables) unless an env is injected.
					env: { ...(options.env ?? inheritedEnv(process.env, options.cwd)) },
				});
			} catch (error) {
				return {
					ok: false,
					error: { kind: "spawn_failed", message: message(error) },
				};
			}

			const collected: Promise<Finished> = Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]).then(([stdout, stderr, exitCode]) => ({
				done: "exited",
				output: { exitCode, stdout, stderr },
			}));
			// A late stream error after a timeout must not become unhandled.
			collected.catch(() => undefined);

			const { timeoutMs } = options;
			let timer: ReturnType<typeof setTimeout> | undefined;
			// Settles on timeout without waiting for the pipes: a grandchild that
			// inherited them (`sh -c "a; b"`, npx/bunx wrappers) can hold them
			// open long after the direct child is killed.
			const deadline = new Promise<Finished>((settle) => {
				if (timeoutMs === undefined) return;
				timer = setTimeout(() => {
					terminate(proc, killGraceMs);
					settle({ done: "timeout", timeoutMs });
				}, timeoutMs);
			});
			try {
				const finished = await Promise.race([collected, deadline]);
				return finished.done === "timeout"
					? {
							ok: false,
							error: { kind: "timeout", timeoutMs: finished.timeoutMs },
						}
					: { ok: true, value: finished.output };
			} catch (error) {
				return {
					ok: false,
					error: { kind: "spawn_failed", message: message(error) },
				};
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/** SIGTERM now; SIGKILL after `graceMs` unless the child has exited by then. */
function terminate(proc: Bun.Subprocess, graceMs: number): void {
	const signal = (sig: NodeJS.Signals): void => {
		try {
			proc.kill(sig);
		} catch {
			// Already gone.
		}
	};
	signal("SIGTERM");
	const escalate = setTimeout(() => signal("SIGKILL"), graceMs);
	proc.exited.then(
		() => clearTimeout(escalate),
		() => clearTimeout(escalate),
	);
}

export const systemProcess: ProcessPort = createSystemProcess();
