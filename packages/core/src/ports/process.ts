import type { Result } from "../db/index";

/** Environment handed to a child process; `undefined` values are dropped. */
export type ProcessEnv = Readonly<Record<string, string | undefined>>;

export type SpawnOptions = Readonly<{
	/** Working directory of the child (explicit; core never uses the process cwd). */
	cwd: string;
	/**
	 * Exact environment for the child. When omitted the real adapter passes
	 * the parent environment minus git's repository-local variables
	 * (`GIT_DIR`, `GIT_INDEX_FILE`, ...), so a caller running inside a git
	 * hook never points a child at the wrong repository.
	 */
	env?: ProcessEnv;
	/** Kill the child and report `timeout` after this many milliseconds. */
	timeoutMs?: number;
}>;

/** A finished child. A non-zero `exitCode` is data, not an error. */
export type ProcessOutput = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
}>;

export type ProcessError =
	| Readonly<{ kind: "spawn_failed"; message: string }>
	| Readonly<{ kind: "timeout"; timeoutMs: number }>;

/** Runs `argv[0]` with `argv.slice(1)` and collects its output. Never rejects. */
export type ProcessPort = Readonly<{
	spawn: (
		argv: readonly string[],
		options: SpawnOptions,
	) => Promise<Result<ProcessOutput, ProcessError>>;
}>;
