/**
 * Retention for GitHub App jobs (FR-REM-3, FR-PRIV-2): a job keeps nothing
 * of the code it ran over, and its log names neither that code nor a path.
 *
 * `runWithoutRetention` gives each job a private scratch directory and
 * points the job's temp directory, `$HOME` and XDG directories into it
 * (`jobEnvironment`), so whatever a tool writes (caches, temp files, logs)
 * lands next to the checkout. The directory is deleted when the job ends,
 * however it ends, and a directory that survives fails the job.
 *
 * `jobLogEvent` is the one line a job logs: which job ran on which pull
 * request, how it ended and how long it took. It never carries a message,
 * a file name, a workspace path or a line of code; those belong to the
 * job's result, which goes back to the caller and is not kept.
 */

import { join } from "node:path";
import type { ProcessEnv, Result } from "@mainahq/core";
import type { RuntimeError } from "@mainahq/mcp";
import { inRemovedDirectory, type Workspaces } from "./checkout";
import {
	JOB_KINDS,
	type JobError,
	type JobReport,
	type JobRequest,
} from "./jobs";

/** The job's log line. Every field is an identifier, a count or a kind. */
type JobLogEvent = Readonly<{
	event: "job";
	kind: string;
	/** `owner/name`, or `(invalid)` when it is not one segment each. */
	repository: string;
	pullNumber: number | null;
	/** The head commit, once the job has read the pull request. */
	head?: string;
	outcome: "ok" | JobError["kind"];
	/** The HTTP status of a GitHub failure. */
	status?: number | null;
	/** The kind of a capability failure. */
	reason?: RuntimeError["kind"];
	durationMs: number;
}>;

type Runner = (request: JobRequest) => Promise<Result<JobReport, JobError>>;

const INVALID = "(invalid)";
const SEGMENT = /^[\w.-]+$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

const segment = (name: string): boolean =>
	SEGMENT.test(name) && name !== "." && name !== "..";

function failure(error: JobError): Partial<JobLogEvent> {
	switch (error.kind) {
		case "github":
			return { status: error.status };
		case "capability":
			return { reason: error.error.kind };
		default:
			return {};
	}
}

export function jobLogEvent(
	request: JobRequest,
	result: Result<JobReport, JobError>,
	durationMs: number,
): JobLogEvent {
	const { owner, name } = request.repository;
	const head =
		result.ok && SHA.test(result.value.head) ? result.value.head : undefined;
	return {
		event: "job",
		kind: (JOB_KINDS as readonly string[]).includes(request.kind)
			? request.kind
			: INVALID,
		repository: segment(owner) && segment(name) ? `${owner}/${name}` : INVALID,
		pullNumber: Number.isSafeInteger(request.pullNumber)
			? request.pullNumber
			: null,
		...(head !== undefined ? { head } : {}),
		outcome: result.ok ? "ok" : result.error.kind,
		...(result.ok ? {} : failure(result.error)),
		durationMs: Math.max(0, Math.round(durationMs)),
	};
}

/**
 * `env` for a job whose scratch directory is `scratch`: the temp
 * directory, `$HOME` and the XDG base directories all point inside it, and
 * every telemetry channel is off.
 */
export function jobEnvironment(env: ProcessEnv, scratch: string): ProcessEnv {
	return {
		...env,
		TMPDIR: scratch,
		TMP: scratch,
		TEMP: scratch,
		HOME: scratch,
		USERPROFILE: scratch,
		XDG_CACHE_HOME: join(scratch, ".cache"),
		XDG_CONFIG_HOME: join(scratch, ".config"),
		XDG_DATA_HOME: join(scratch, ".local", "share"),
		XDG_STATE_HOME: join(scratch, ".local", "state"),
		DO_NOT_TRACK: "1",
		MAINA_TELEMETRY: "0",
	};
}

/**
 * Runs one job in a private scratch directory from `scratch`, deletes the
 * directory afterwards (verified), and answers the job's result with its
 * log line. `runnerFor` builds the job runner for that directory and the
 * environment its tools must run with.
 */
export async function runWithoutRetention(
	options: Readonly<{
		scratch: Pick<Workspaces, "create" | "remove" | "exists">;
		env: ProcessEnv;
		now: () => number;
		runnerFor: (job: Readonly<{ scratch: string; env: ProcessEnv }>) => Runner;
	}>,
	request: JobRequest,
): Promise<
	Readonly<{ result: Result<JobReport, JobError>; log: JobLogEvent }>
> {
	const started = options.now();
	const ran = await inRemovedDirectory(options.scratch, (dir) =>
		options.runnerFor({ scratch: dir, env: jobEnvironment(options.env, dir) })(
			request,
		),
	);
	const result: Result<JobReport, JobError> = ran.ok
		? { ok: true, value: ran.value.value }
		: ran;
	return {
		result,
		log: jobLogEvent(request, result, options.now() - started),
	};
}
