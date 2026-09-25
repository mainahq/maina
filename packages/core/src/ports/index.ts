import type { ClockPort } from "./clock";
import type { DbPort } from "./db";
import type { EnvPort } from "./env";
import type { FsPort } from "./fs";
import type { GitPort } from "./git";
import type { LoggerPort } from "./logger";
import type { ModelPort } from "./model";
import type { ProcessPort } from "./process";

export type { ClockPort } from "./clock";
export type { DbError, DbPort, DbRow, DbValue } from "./db";
export type { EnvPort } from "./env";
export type { FsError, FsPort } from "./fs";
export type { GitError, GitPort } from "./git";
export type { LogFields, LoggerPort, LogLevel } from "./logger";
export type {
	ModelError,
	ModelPort,
	ModelRequest,
	ModelResponse,
} from "./model";
export type {
	ProcessEnv,
	ProcessError,
	ProcessOutput,
	ProcessPort,
	SpawnOptions,
} from "./process";

/**
 * Every side effect the functional core may perform. Public core functions
 * take `ports` (or a context carrying them) plus an explicit `root`. Runtime
 * builds the real adapters; tests use the in-memory fakes in `ports/testing`.
 */
export type CorePorts = Readonly<{
	fs: FsPort;
	git: GitPort;
	db: DbPort;
	clock: ClockPort;
	logger: LoggerPort;
	model: ModelPort;
	env: EnvPort;
	process: ProcessPort;
}>;
