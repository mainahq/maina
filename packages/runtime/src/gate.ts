/**
 * Gate port (FR-GATE-1, FR-GATE-3).
 *
 * The runtime and the hook client both evaluate a normalised gate event
 * through a `GateEvaluator`. This module defines that port, the fail-closed
 * helpers around it and `createGateEvaluator`, which turns a wire event into
 * a core `GateEvent` and runs core's `evaluateGate` on it: in full in the
 * daemon, rules-only in the hook client's fallback. `gate-system.ts` builds
 * the real dependencies.
 */

import { isAbsolute, resolve } from "node:path";
import {
	appendDecision,
	type BackendRegistry,
	buildDecisionRecord,
	type ClockPort,
	type GateEvent as CoreGateEvent,
	type DbPort,
	DEFAULT_REGISTRY,
	evaluateGate,
	type GateContext,
	type GateEvaluation,
	gateSubject,
	logPrivacy,
	type PermissionMode,
	type Policy,
	type Result,
	recordGateSubject,
	VERDICTS,
	type Verdict,
	withBackend,
} from "@mainahq/core";

/** A host hook event after adapter normalisation. JSON-serialisable. */
export type GateEvent = Readonly<{
	/** Normalised event kind, such as `shell`, `file.write` or `mcp`. */
	kind: string;
	/**
	 * Tool input as the adapter normalised it. Per kind: `shell` has
	 * `command`; `file.write` has `path` (or `file_path`) and optional
	 * `content`; `file.read.outside` has `path` (or `file_path`); `mcp` has
	 * `server`, `tool` and optional `arguments`; `network` has `url` and
	 * optional `method`. Any kind may carry `host`, `sessionId`,
	 * `permissionMode` and `untrusted` (provenance strings).
	 */
	input: Readonly<Record<string, unknown>>;
	/** Directory the host reported for the event, when it gave one. */
	cwd?: string;
}>;

/** What an evaluator decides for one event. JSON-serialisable (the wire). */
export type GateDecision = Readonly<{
	verdict: Verdict;
	reason: string;
	/** Ids of the `action.risk` decisions behind the verdict, for the log. */
	decisionIds: readonly string[];
	/**
	 * The gate could not run in full: core's `evaluateGate` fell back (no
	 * model answer, no shell grammar) or the event could not be evaluated.
	 */
	degraded: boolean;
}>;

/** The gate port: evaluates one event. May be sync or async. */
export type GateEvaluator = (
	event: GateEvent,
) => GateDecision | Promise<GateDecision>;

/** Why the hook client fell back to the in-process rules-only evaluation. */
export type DegradedCause =
	| "connect_failed"
	| "spawn_failed"
	| "timeout"
	| "closed"
	| "bad_response"
	| "bad_request"
	| "unknown_method"
	| "not_implemented"
	| "handler_failed"
	| "version_mismatch"
	/** The client itself failed unexpectedly (a port threw). */
	| "client_error"
	/** The socket's dir is not private to this user, so no answer is trusted. */
	| "insecure_endpoint";

/**
 * What the hook client returns for one event. A runtime answer keeps the
 * runtime's own `degraded` flag; the in-process fallback is always degraded.
 * A degraded result is never `allow`.
 */
export type GateResult = GateDecision &
	(
		| Readonly<{ source: "runtime" }>
		| Readonly<{
				degraded: true;
				source: "fallback";
				degradedCause: DegradedCause;
		  }>
	);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isVerdict = (value: unknown): value is Verdict =>
	typeof value === "string" && (VERDICTS as readonly string[]).includes(value);

/** A gate event from untrusted JSON, or null when it has the wrong shape. */
export function parseGateEvent(value: unknown): GateEvent | null {
	if (!isRecord(value)) return null;
	const { kind, input, cwd } = value;
	if (typeof kind !== "string" || kind === "" || !isRecord(input)) return null;
	if (cwd !== undefined && typeof cwd !== "string") return null;
	return cwd === undefined ? { kind, input } : { kind, input, cwd };
}

const isStringArray = (value: unknown): value is readonly string[] =>
	Array.isArray(value) && value.every((v) => typeof v === "string");

/**
 * A gate decision from untrusted input, or null when it has the wrong shape.
 * A missing `degraded` flag is rejected rather than read as `false`.
 */
export function parseGateDecision(value: unknown): GateDecision | null {
	if (!isRecord(value)) return null;
	const { verdict, reason, decisionIds, degraded } = value;
	if (!isVerdict(verdict) || typeof reason !== "string") return null;
	if (!isStringArray(decisionIds) || typeof degraded !== "boolean") {
		return null;
	}
	return { verdict, reason, decisionIds: [...decisionIds], degraded };
}

/**
 * Fail closed: a decision reached on an error path is never `allow`. An
 * `allow` tightens to `ask`; `ask` and `deny` stand.
 */
export function failClosed(decision: GateDecision): GateDecision {
	return decision.verdict === "allow"
		? { ...decision, verdict: "ask" }
		: decision;
}

// ── Evaluator ───────────────────────────────────────────────────────────────

/** What `createGateEvaluator` needs; `gate-system.ts` builds the real ones. */
export type GateEvaluatorDeps = Readonly<{
	/** The workspace root for an event's directory, or null outside a repo. */
	rootOf: (cwd: string) => string | null;
	/** The effective policy for a root; an error makes the event ask. */
	policyFor: (root: string) => Promise<Result<Policy, unknown>>;
	/** Classification context: the shell grammar and the home directory. */
	context: () => Promise<GateContext>;
	/**
	 * The branch checked out in a root, or null when there is none (detached
	 * HEAD), for pushes with an implicit target (`git push`, `git push origin
	 * HEAD`). Looked up for shell events only; an error (or a rejection)
	 * makes the event ask, since an unknown branch would let a bare push to a
	 * protected branch through. Absent: no current branch is known.
	 */
	branchOf?: (root: string) => Promise<Result<string | null, unknown>>;
	clock: ClockPort;
	newId: () => string;
	/** Defaults to core's `DEFAULT_REGISTRY`. */
	backends?: BackendRegistry;
	/** Repo loosenings the user confirmed (see core `GatePorts`). */
	confirmedLoosenings?: readonly string[];
	/**
	 * Where a root's gate decisions are logged, or null when that root keeps
	 * no log. Absent: nothing is logged. A failure only skips the logging.
	 */
	logFor?: (root: string) => Promise<Result<GateLog | null, unknown>>;
}>;

/** A root's decision log (FR-DEC-3, FR-DEC-5). */
export type GateLog = Readonly<{
	db: DbPort;
	/** The repo's salt (core `loadLogSalt`): every record is keyed by it. */
	salt: string;
	/** Wall-clock milliseconds, for the records' `ts`. */
	now: () => number;
}>;

/**
 * `full` runs `action.risk` on the backend the policy names; `rules_only`
 * pins it to the rules backend, for the hook client's in-process fallback.
 */
type GateMode = "full" | "rules_only";

/** An event the gate could not evaluate: it asks, degraded. */
const asking = (why: string): GateDecision => ({
	verdict: "ask",
	reason: `${why}; asking`,
	decisionIds: [],
	degraded: true,
});

/** Runs core's `evaluateGate` on wire events. Never rejects; failures ask. */
export function createGateEvaluator(
	deps: GateEvaluatorDeps,
	mode: GateMode = "full",
): GateEvaluator {
	return async (event) => {
		try {
			if (event.cwd === undefined) {
				return asking("the event has no working directory");
			}
			const root = deps.rootOf(event.cwd);
			if (root === null) return asking(`${event.cwd} is not in a repository`);
			const core = toCoreGateEvent(event, root);
			if (core === null) return asking(`malformed ${event.kind} event`);
			const policy = await deps.policyFor(root);
			if (!policy.ok) return asking(`the policy for ${root} is invalid`);
			const ctx = await contextFor(deps, core);
			if (!ctx.ok) {
				return asking(`the checked-out branch in ${root} could not be read`);
			}
			const effective =
				mode === "rules_only"
					? withBackend(policy.value, "action.risk", "rules")
					: policy.value;
			const result = evaluateGate(
				{
					clock: deps.clock,
					backends: deps.backends ?? DEFAULT_REGISTRY,
					ctx: ctx.value,
					newId: deps.newId,
					confirmedLoosenings: deps.confirmedLoosenings,
				},
				core,
				effective,
			);
			await logDecisions(deps, root, {
				event: core,
				policy: effective,
				ctx: ctx.value,
				result,
				tightens: mode === "rules_only",
			});
			return {
				verdict: result.verdict,
				reason: result.reason,
				decisionIds: result.decisionIds,
				degraded: result.degraded,
			};
		} catch (e) {
			return asking(
				`maina gate failed (${e instanceof Error ? e.message : String(e)})`,
			);
		}
	};
}

/**
 * The classification context for `event`: the shared one, plus the branch
 * checked out in the event's root when a shell command may push to it. An
 * error when the branch could not be read.
 */
async function contextFor(
	deps: GateEvaluatorDeps,
	event: CoreGateEvent,
): Promise<Result<GateContext, unknown>> {
	const ctx = await deps.context();
	if (event.kind !== "shell" || deps.branchOf === undefined) {
		return { ok: true, value: ctx };
	}
	const branch = await deps.branchOf(event.root);
	if (!branch.ok) return branch;
	return {
		ok: true,
		value:
			branch.value === null ? ctx : { ...ctx, currentBranch: branch.value },
	};
}

/** One evaluated event, as the log needs it. */
type Evaluated = Readonly<{
	event: CoreGateEvent;
	/** The policy the gate evaluated with. */
	policy: Policy;
	/** The context the gate classified with, the checked-out branch included. */
	ctx: GateContext;
	result: GateEvaluation;
	/** The caller turns an allow into an ask (the rules-only fallback). */
	tightens: boolean;
}>;

/**
 * Appends each `action.risk` decision behind `result` to the root's log,
 * keyed by the repo's salt, allows included (#480), with the action the
 * host was told as `finalAction`, and, for an ask or a deny, records its subject
 * under `decisionIds[0]`: the id the gate message names, so `maina allow
 * <id> [--always]` finds both (#448). Never rejects and never changes the
 * verdict: a log that cannot be opened, or a salt that cannot be loaded,
 * logs nothing (never an unsalted record), and a failed write skips that
 * record.
 */
async function logDecisions(
	deps: GateEvaluatorDeps,
	root: string,
	{ event, policy, ctx, result, tightens }: Evaluated,
): Promise<void> {
	const { decided } = result;
	if (deps.logFor === undefined || decided === undefined) return;
	try {
		const log = await deps.logFor(root);
		if (!log.ok || log.value === null) return;
		const { db, salt, now } = log.value;
		const privacy = logPrivacy(decided.policy, salt);
		const ts = now();
		// What the host was told: the fallback's allow reaches it as an ask.
		const finalAction =
			tightens && result.verdict === "allow" ? "ask" : result.verdict;
		for (const { request, decision } of decided.answers) {
			const record = buildDecisionRecord(
				{
					id: decision.id,
					ts,
					request,
					decision,
					policy: decided.policy,
					finalAction,
					host: event.host,
					sessionId: event.sessionId === "" ? undefined : event.sessionId,
				},
				privacy,
			);
			if (record.ok) appendDecision({ db, privacy }, record.value);
		}
		// The hook client's fallback tightens every allow to an ask, so there
		// each id may reach a gate message.
		const [id] = result.decisionIds;
		if (id !== undefined && (result.verdict !== "allow" || tightens)) {
			recordGateSubject(db, gateSubject(id, event, policy, ctx));
		}
	} catch {
		// The log is evidence, not the gate: losing a record never blocks.
	}
}

// ── Wire event → core event ─────────────────────────────────────────────────

const PERMISSION_MODES: readonly PermissionMode[] = [
	"default",
	"plan",
	"accept_edits",
	"bypass",
	"unknown",
];

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

/**
 * A relative file path made absolute against the directory the host ran the
 * tool in. Core resolves relative paths against the workspace root, which
 * is wrong from a subdirectory: `../../w/repo/x` from `/w/repo/sub` is
 * outside the repo, but reads as inside against `/w/repo`. Absolute and
 * home-relative paths are left for core, which expands them.
 */
function againstCwd(
	path: string | undefined,
	cwd: string | undefined,
): string | undefined {
	if (path === undefined || cwd === undefined || isAbsolute(path)) return path;
	const home = HOME_WORDS.some((w) => path === w || path.startsWith(`${w}/`));
	return home ? path : resolve(cwd, path);
}

/** Home spellings core's path resolution expands (see core `gate/paths`). */
const HOME_WORDS: readonly string[] = ["~", "$HOME", "${HOME}"];

/**
 * The core event for a wire event under workspace `root`, or null when the
 * kind is unknown or a required field is missing. Metadata of the wrong
 * type falls back to neutral values.
 */
export function toCoreGateEvent(
	event: GateEvent,
	root: string,
): CoreGateEvent | null {
	const { input } = event;
	const meta = {
		host: text(input.host) ?? "unknown",
		sessionId: typeof input.sessionId === "string" ? input.sessionId : "",
		root,
		permissionMode:
			PERMISSION_MODES.find((m) => m === input.permissionMode) ?? "unknown",
		untrusted: Array.isArray(input.untrusted)
			? input.untrusted.filter((u): u is string => typeof u === "string")
			: [],
	} as const;
	const path = againstCwd(text(input.path) ?? text(input.file_path), event.cwd);
	switch (event.kind) {
		case "shell": {
			const command = text(input.command);
			if (command === undefined) return null;
			const action =
				event.cwd === undefined ? { command } : { command, cwd: event.cwd };
			return { ...meta, kind: "shell", action };
		}
		case "file.write": {
			if (path === undefined) return null;
			const content =
				typeof input.content === "string" ? input.content : undefined;
			const action = content === undefined ? { path } : { path, content };
			return { ...meta, kind: "file.write", action };
		}
		case "file.read.outside":
			return path === undefined
				? null
				: { ...meta, kind: "file.read.outside", action: { path } };
		case "mcp": {
			const server = text(input.server);
			const tool = text(input.tool);
			if (server === undefined || tool === undefined) return null;
			const args = isRecord(input.arguments) ? input.arguments : undefined;
			const action =
				args === undefined ? { server, tool } : { server, tool, input: args };
			return { ...meta, kind: "mcp", action };
		}
		case "network": {
			const url = text(input.url);
			if (url === undefined) return null;
			const method = text(input.method);
			const action = method === undefined ? { url } : { url, method };
			return { ...meta, kind: "network", action };
		}
		default:
			return null;
	}
}
