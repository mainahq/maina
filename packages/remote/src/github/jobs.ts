/**
 * GitHub App jobs (FR-REM-2, FR-REM-3): one maina capability run against
 * one pull request, on the service's side.
 *
 * A job authenticates as the App, takes an installation token for the
 * PR's repository (read-only unless the operator widened `permissions`),
 * reads the pull request, its changed files and its merge base (the diff
 * base, where head forked from the base branch), checks the PR out into an
 * ephemeral workspace, runs the requested capability through the runtime
 * built for that workspace, and deletes the workspace afterwards
 * (verified). The token is revoked when the job ends, however it ends.
 *
 * The runtime is wrapped with `remoteRuntime`, so a job acts only on its
 * own checkout and `decide` refuses the local action gate's types, exactly
 * as the remote MCP tools do.
 */

import type {
	CodeGraphImpactReport,
	DecideRequest,
	Decision,
	PipelineResult,
	Result,
} from "@mainahq/core";
import type { McpRuntime, RuntimeError } from "@mainahq/mcp";
import { remoteRuntime } from "../tools";
import type {
	AppCredentials,
	ChangedFile,
	GitHubApi,
	GitHubError,
	Permissions,
	RepoRef,
} from "./app";
import {
	inEphemeralWorkspace,
	type RemovedWorkspace,
	type WorkspaceError,
	type Workspaces,
} from "./checkout";

/** The jobs the App runs on a pull request. */
export const JOB_KINDS = [
	"verify",
	"impact",
	"triage",
	"spec_check",
	"decide",
] as const;

type JobKind = (typeof JOB_KINDS)[number];

type Target = Readonly<{
	installationId: number;
	repository: RepoRef;
	pullNumber: number;
}>;

export type JobRequest = Target &
	(
		| Readonly<{ kind: "verify" }>
		| Readonly<{ kind: "impact"; depth?: number }>
		| Readonly<{ kind: "triage" }>
		| Readonly<{
				kind: "spec_check";
				/** Feature directories; default: those the PR touches. */
				paths?: readonly string[];
		  }>
		| Readonly<{ kind: "decide"; request: DecideRequest }>
	);

type Value<T> = T extends Promise<Result<infer V, unknown>> ? V : never;

type JobResults = Readonly<{
	verify: PipelineResult;
	impact: CodeGraphImpactReport;
	triage: Value<ReturnType<McpRuntime["review"]>>;
	spec_check: Value<ReturnType<McpRuntime["specCheck"]>>;
	decide: readonly Decision[];
}>;

/** Which capability ran and what it answered. */
type JobOutcome = {
	[K in JobKind]: Readonly<{ kind: K; result: JobResults[K] }>;
}[JobKind];

type JobReport = JobOutcome &
	Readonly<{
		/** `owner/name` */
		repository: string;
		pullNumber: number;
		head: string;
		/** The merge base the job diffed against (not the base branch's tip). */
		base: string;
		workspace: RemovedWorkspace;
	}>;

type JobError =
	| Readonly<{ kind: "invalid_request"; message: string }>
	| GitHubError
	| WorkspaceError
	| Readonly<{ kind: "cleanup_failed"; path: string; message: string }>
	| Readonly<{ kind: "capability"; error: RuntimeError }>;

type JobRunnerOptions = Readonly<{
	credentials: AppCredentials;
	api: GitHubApi;
	workspaces: Workspaces;
	/** The runtime for a checked-out workspace root. */
	runtimeFor: (root: string) => McpRuntime;
	/** Installation token permissions; default `READ_ONLY_PERMISSIONS`. */
	permissions?: Permissions;
}>;

const invalid = (message: string): Result<never, JobError> => ({
	ok: false,
	error: { kind: "invalid_request", message },
});

const FEATURE_DIR = /^\.maina\/features\/[^/]+(?=\/)/;

/** A GitHub owner or repository name: one path segment, never `.` or `..`. */
const segment = (name: string): boolean =>
	/^[\w.-]+$/.test(name) && name !== "." && name !== "..";

/** A repo-relative path that cannot leave the workspace. */
const contained = (path: string): boolean =>
	path.length > 0 &&
	!path.startsWith("/") &&
	!/^[A-Za-z]:/.test(path) &&
	!path.split(/[\\/]/).includes("..");

function checkRequest(request: JobRequest): Result<void, JobError> {
	if (!(JOB_KINDS as readonly string[]).includes(request.kind)) {
		return invalid(
			`unknown job kind ${JSON.stringify(request.kind)}; expected one of ${JOB_KINDS.join(", ")}`,
		);
	}
	if (!segment(request.repository.owner) || !segment(request.repository.name)) {
		return invalid("repository must be an owner and a name, one segment each");
	}
	if (
		!Number.isInteger(request.installationId) ||
		request.installationId <= 0
	) {
		return invalid("installationId must be a positive integer");
	}
	if (!Number.isInteger(request.pullNumber) || request.pullNumber <= 0) {
		return invalid("pullNumber must be a positive integer");
	}
	if (request.kind === "spec_check" && request.paths !== undefined) {
		const outside = request.paths.find((p) => !contained(p));
		if (outside !== undefined) {
			return invalid(
				`spec path ${JSON.stringify(outside)} leaves the workspace`,
			);
		}
	}
	return { ok: true, value: undefined };
}

/** The feature directories a set of changed files falls in, sorted. */
const featureDirs = (files: readonly string[]): string[] =>
	[
		...new Set(
			files.flatMap((f) => {
				const match = FEATURE_DIR.exec(f);
				return match === null ? [] : [match[0]];
			}),
		),
	].sort();

/** Runs the capability `request` names over the checkout at `root`. */
async function runCapability(
	runtime: McpRuntime,
	root: string,
	request: JobRequest,
	/** The commit the PR forked from; its diffs are taken against it. */
	base: string,
	changed: readonly ChangedFile[],
): Promise<Result<JobOutcome, JobError>> {
	const present = changed
		.filter((f) => f.status !== "removed")
		.map((f) => f.path);
	const capability = <K extends JobKind>(
		kind: K,
		result: Result<JobResults[K], RuntimeError>,
	): Result<Readonly<{ kind: K; result: JobResults[K] }>, JobError> =>
		result.ok
			? { ok: true, value: { kind, result: result.value } }
			: { ok: false, error: { kind: "capability", error: result.error } };

	switch (request.kind) {
		case "verify":
			return capability(
				"verify",
				await runtime.verify({ root, files: present, base }),
			);
		case "impact":
			return capability(
				"impact",
				await runtime.impact({
					root,
					files: present,
					...(request.depth !== undefined ? { depth: request.depth } : {}),
				}),
			);
		case "triage":
			return capability("triage", await runtime.review({ root, base }));
		case "spec_check":
			return capability(
				"spec_check",
				await runtime.specCheck({
					root,
					paths: request.paths ?? featureDirs(changed.map((f) => f.path)),
				}),
			);
		case "decide":
			return capability(
				"decide",
				await runtime.decide({ root, request: request.request }),
			);
		default: {
			const unhandled: never = request;
			return invalid(`unknown job ${JSON.stringify(unhandled)}`);
		}
	}
}

/**
 * A runner for PR jobs. Each call is one job; it never throws, and it
 * leaves no workspace and no live token behind.
 */
export function createJobRunner(
	options: JobRunnerOptions,
): (request: JobRequest) => Promise<Result<JobReport, JobError>> {
	return async (request) => {
		const checked = checkRequest(request);
		if (!checked.ok) return checked;

		const appJwt = await options.credentials.appJwt();
		if (!appJwt.ok) return appJwt;
		const token = await options.api.installationToken({
			appJwt: appJwt.value,
			installationId: request.installationId,
			repository: request.repository,
			...(options.permissions !== undefined
				? { permissions: options.permissions }
				: {}),
		});
		if (!token.ok) return token;

		try {
			const call = {
				token: token.value.token,
				repository: request.repository,
				number: request.pullNumber,
			};
			const pull = await options.api.pullRequest(call);
			if (!pull.ok) return pull;
			const changed = await options.api.pullRequestFiles(call);
			if (!changed.ok) return changed;
			const base = await options.api.mergeBase({
				token: token.value.token,
				repository: request.repository,
				base: pull.value.baseSha,
				head: pull.value.headSha,
			});
			if (!base.ok) return base;

			const ran = await inEphemeralWorkspace(
				options.workspaces,
				{
					cloneUrl: pull.value.cloneUrl,
					token: token.value.token,
					head: pull.value.headSha,
					base: base.value,
				},
				(dir) =>
					runCapability(
						remoteRuntime(options.runtimeFor(dir), dir),
						dir,
						request,
						base.value,
						changed.value,
					),
			);
			if (!ran.ok) return ran;
			return {
				ok: true,
				value: {
					...ran.value.value,
					repository: `${request.repository.owner}/${request.repository.name}`,
					pullNumber: request.pullNumber,
					head: pull.value.headSha,
					base: base.value,
					workspace: ran.value.workspace,
				},
			};
		} finally {
			// Best effort: an unrevoked token still expires within the hour.
			await options.api.revokeToken(token.value.token).catch(() => undefined);
		}
	};
}
