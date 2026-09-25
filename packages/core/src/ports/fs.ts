import type { Result } from "../db/index";

export type FsError =
	| Readonly<{ kind: "not_found"; path: string }>
	| Readonly<{ kind: "io"; path: string; message: string }>;

/** Filesystem access. Paths are absolute; core never resolves against a cwd. */
export type FsPort = Readonly<{
	readFile: (path: string) => Promise<Result<string, FsError>>;
	/** Creates missing parent directories. */
	writeFile: (path: string, content: string) => Promise<Result<void, FsError>>;
	exists: (path: string) => Promise<boolean>;
	/** Immediate entry names of a directory, sorted. */
	readDir: (path: string) => Promise<Result<readonly string[], FsError>>;
	remove: (path: string) => Promise<Result<void, FsError>>;
}>;
