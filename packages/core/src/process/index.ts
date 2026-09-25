/**
 * The real `ProcessPort` (#420): the one place in core that spawns child
 * processes. Core modules take a `ProcessPort` (this adapter by default;
 * tests pass the fake from `ports/testing`), so the purity ratchet can flag
 * every other direct `Bun.spawn`.
 */

import type { ProcessEnv, ProcessPort } from "../ports/process";

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

/** `env` without git's repository-local variables. Pure. */
export function stripRepoLocalGitEnv(env: ProcessEnv): ProcessEnv {
	return Object.fromEntries(
		Object.entries(env).filter(([name]) => !REPO_LOCAL_GIT_VARS.has(name)),
	);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const systemProcess: ProcessPort = {
	spawn: async (argv, options) => {
		let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
		try {
			proc = Bun.spawn([...argv], {
				cwd: options.cwd,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				// Adapter boundary: the child inherits the parent environment
				// (minus repo-local git variables) unless an env is injected.
				env: { ...(options.env ?? stripRepoLocalGitEnv(process.env)) },
			});
		} catch (error) {
			return {
				ok: false,
				error: { kind: "spawn_failed", message: message(error) },
			};
		}

		let timedOut = false;
		const timer =
			options.timeoutMs === undefined
				? undefined
				: setTimeout(() => {
						timedOut = true;
						proc.kill();
					}, options.timeoutMs);
		try {
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			if (timedOut && options.timeoutMs !== undefined) {
				return {
					ok: false,
					error: { kind: "timeout", timeoutMs: options.timeoutMs },
				};
			}
			return { ok: true, value: { exitCode, stdout, stderr } };
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
