/**
 * Gate port (FR-GATE-1).
 *
 * The runtime and the hook client both evaluate a normalised gate event
 * through a `GateEvaluator`. This module only defines that port and the
 * fail-closed helpers around it. The real evaluators (the rules engine and
 * the decision backends) plug in here in later tasks; until then the daemon
 * runs `pendingGate`, which asks.
 */

import { VERDICTS, type Verdict } from "@mainahq/core";

/** A host hook event after adapter normalisation. JSON-serialisable. */
export type GateEvent = Readonly<{
	/** Normalised event kind, such as `shell`, `file.write` or `mcp`. */
	kind: string;
	/** Tool input as the adapter normalised it. */
	input: Readonly<Record<string, unknown>>;
	/** Directory the host reported for the event, when it gave one. */
	cwd?: string;
}>;

/** What an evaluator decides for one event. */
export type GateDecision = Readonly<{ verdict: Verdict; reason: string }>;

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
	| "version_mismatch";

/** What the hook client returns for one event. */
export type GateResult = GateDecision &
	(
		| Readonly<{ degraded: false; source: "runtime" }>
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

/** A gate decision from untrusted input, or null when it has the wrong shape. */
export function parseGateDecision(value: unknown): GateDecision | null {
	if (!isRecord(value)) return null;
	const { verdict, reason } = value;
	if (!isVerdict(verdict) || typeof reason !== "string") return null;
	return { verdict, reason };
}

/**
 * Fail closed: a decision reached on an error path is never `allow`. An
 * `allow` tightens to `ask`; `ask` and `deny` stand.
 */
export function failClosed(decision: GateDecision): GateDecision {
	return decision.verdict === "allow"
		? { verdict: "ask", reason: decision.reason }
		: decision;
}

/** Placeholder runtime gate until the real evaluator is wired in: always asks. */
export const pendingGate: GateEvaluator = () => ({
	verdict: "ask",
	reason: "maina gate evaluator is not configured yet",
});
