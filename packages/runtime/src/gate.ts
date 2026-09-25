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
	type BackendRegistry,
	type ClockPort,
	type GateEvent as CoreGateEvent,
	DEFAULT_REGISTRY,
	evaluateGate,
	type GateContext,
	type PermissionMode,
	type Policy,
	type Result,
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
	clock: ClockPort;
	newId: () => string;
	/** Defaults to core's `DEFAULT_REGISTRY`. */
	backends?: BackendRegistry;
	/** Repo loosenings the user confirmed (see core `GatePorts`). */
	confirmedLoosenings?: readonly string[];
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
			const result = evaluateGate(
				{
					clock: deps.clock,
					backends: deps.backends ?? DEFAULT_REGISTRY,
					ctx: await deps.context(),
					newId: deps.newId,
					confirmedLoosenings: deps.confirmedLoosenings,
				},
				core,
				mode === "rules_only"
					? withBackend(policy.value, "action.risk", "rules")
					: policy.value,
			);
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
