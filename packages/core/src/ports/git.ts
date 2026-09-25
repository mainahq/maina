import type { Result } from "../db/index";

export type GitError =
	| Readonly<{ kind: "not_a_repo"; root: string }>
	| Readonly<{ kind: "failed"; exitCode: number; stderr: string }>;

/** Runs `git <args>` inside an explicit repository root and returns stdout. */
export type GitPort = Readonly<{
	run: (
		root: string,
		args: readonly string[],
	) => Promise<Result<string, GitError>>;
}>;
