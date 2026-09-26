/**
 * The gate, as the permission bridges ask it (FR-HAR-2). Pure: the gate's
 * ports and the log are injected.
 *
 * Every host a worker runs in asks permission its own way: an ACP agent
 * sends `session/request_permission`, Claude Code runs a `PreToolUse` hook,
 * `codex app-server` sends approval requests. Each bridge normalises its
 * request into core `GateEvent`s and asks `judgeActions`, which runs core's
 * `evaluateGate` on each and keeps the strictest verdict. Each request's
 * outcome is logged as one `PermissionRecord`, whatever it was.
 *
 * Fail closed: an action whose target could not be read (`opaque`) asks,
 * and a run has nobody to ask, so every bridge answers `ask` with a reject.
 * A request with no gated action (a plan, a search) is allowed: the gate
 * has no opinion, and the sandbox still holds.
 *
 * A bridge with a run `context` judges against the policy as that context
 * sees it (FR-HAR-4): unattended, an `ask` is a `deny`, and merging,
 * releasing and publishing are denied outright.
 */

import {
	evaluateGate,
	type GateEvent,
	type GatePorts,
	type Policy,
	type RunContext,
	VERDICTS,
	type Verdict,
} from "@mainahq/core";
import { policyForContext, verdictForContext } from "../run/context";

/** Which bridge a permission request came through. */
type PermissionSource = "acp" | "claude-hook" | "codex-app-server";

/** One permission request and how it was answered: the audit trail. */
export type PermissionRecord = Readonly<{
	source: PermissionSource;
	/** The host the gate saw (`acp:claude`, `claude-code`, `codex`). */
	host: string;
	sessionId: string;
	/** The host's id for the call: a tool-call id, an item id, a tool name. */
	toolCallId: string;
	gate: readonly GateEvent[];
	opaque: boolean;
	verdict: Verdict;
	reason: string;
	degraded: boolean;
	decisionIds: readonly string[];
	/** What the host was answered, in its own terms (`allow_once`, `decline`). */
	answer: string;
}>;

export type PermissionLog = (record: PermissionRecord) => void;

/** What every bridge needs: the gate, the run's policy and the log. */
export type GateBridge = Readonly<{
	ports: GatePorts;
	policy: Policy;
	log: PermissionLog;
	/**
	 * Who is there to answer (FR-HAR-4). Unattended, every `ask` is a
	 * `deny` and merging, releasing and publishing are denied; see
	 * `../run/context`. Unset, the policy applies as it is.
	 */
	context?: RunContext;
}>;

type Judgement = Readonly<{
	verdict: Verdict;
	reason: string;
	degraded: boolean;
	decisionIds: readonly string[];
}>;

const strictness = (verdict: Verdict): number => VERDICTS.indexOf(verdict);

/**
 * The gate's verdict on everything one request would do: the strictest of
 * `evaluateGate` over each event; `ask` when the target is unreadable.
 */
export function judgeActions(
	bridge: GateBridge,
	gate: readonly GateEvent[],
	opaque: boolean,
): Judgement {
	const { context } = bridge;
	if (context === undefined)
		return judgeWith(bridge.policy, bridge, gate, opaque);
	const judged = judgeWith(
		policyForContext(bridge.policy, context),
		bridge,
		gate,
		opaque,
	);
	const verdict = verdictForContext(context, judged.verdict);
	if (verdict === judged.verdict) {
		return verdict === "deny" && context === "unattended"
			? { ...judged, reason: `${judged.reason} (unattended run)` }
			: judged;
	}
	return {
		...judged,
		verdict,
		reason: `${judged.reason}; an unattended run has nobody to ask, so it is denied`,
	};
}

function judgeWith(
	policy: Policy,
	bridge: GateBridge,
	gate: readonly GateEvent[],
	opaque: boolean,
): Judgement {
	if (opaque) {
		return {
			verdict: "ask",
			reason: "the action's target could not be read; asking",
			degraded: true,
			decisionIds: [],
		};
	}
	if (gate.length === 0) {
		return {
			verdict: "allow",
			reason: "no gated action",
			degraded: false,
			decisionIds: [],
		};
	}
	const results = gate.map((event) =>
		evaluateGate(bridge.ports, event, policy),
	);
	const verdict = results.reduce<Verdict>(
		(worst, r) =>
			strictness(r.verdict) > strictness(worst) ? r.verdict : worst,
		"allow",
	);
	return {
		verdict,
		reason: [...new Set(results.map((r) => r.reason))].join("; "),
		degraded: results.some((r) => r.degraded),
		decisionIds: results.flatMap((r) => r.decisionIds),
	};
}

/** Logs `record`. The log is evidence, not the gate: a failure never blocks. */
export function logPermission(
	bridge: GateBridge,
	record: PermissionRecord,
): void {
	try {
		bridge.log(record);
	} catch {
		// Losing a record never changes the answer.
	}
}
