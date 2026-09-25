/**
 * One Claude Code hook run (FR-GATE-7): raw stdin → `fromClaude` → the gate
 * or the session summary → `toClaude`. The gate and the summary are ports;
 * `hook-system.ts` builds the real ones (the fail-closed hook client and the
 * decision log).
 *
 * Never rejects. A payload it cannot read, a gate that throws or answers
 * with the wrong shape: each asks. A summary that fails is left out, so a
 * session start or stop is never held up by it.
 */

import {
	type ClaudeEvent,
	type ClaudeOutput,
	fromClaude,
	type SessionEvent,
	toClaude,
} from "./adapters/claude-code";
import {
	failClosed,
	type GateDecision,
	type GateEvent,
	type GateResult,
	parseGateDecision,
} from "./gate";
import { SESSION_STOP } from "./stop-verify";

export type ClaudeHookPorts = Readonly<{
	/** The gate for one event; the hook client in production. */
	evaluate: (event: GateEvent) => Promise<GateDecision>;
	/** The one-line session summary, or undefined when there is nothing to say. */
	sessionSummary: (event: SessionEvent) => Promise<string | undefined>;
	/**
	 * Verify on stop (FR-VER-7): the runtime's decision for a `session.stop`
	 * event, asked with a budget long enough for a verify run (#480). A deny
	 * blocks the stop; an allow's reason is shown. Absent: no verify.
	 */
	stopVerify?: (event: GateEvent) => Promise<GateDecision>;
}>;

export type ClaudeHookRun = Readonly<{
	event: ClaudeEvent;
	/** The gate's decision for a tool event (asks for a malformed one). */
	decision?: GateDecision;
	output: ClaudeOutput;
}>;

/** What SessionStart tells the agent. */
export const GUARDRAILS_ACTIVE = "maina guardrails active for this repository.";

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

export function parseHookInput(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export async function safeDecision(
	ports: ClaudeHookPorts,
	event: GateEvent,
): Promise<GateDecision> {
	try {
		const decision = parseGateDecision(await ports.evaluate(event));
		return (
			decision ??
			failClosed({
				verdict: "ask",
				reason: "the maina gate gave no usable answer",
				decisionIds: [],
				degraded: true,
			})
		);
	} catch (e) {
		return {
			verdict: "ask",
			reason: `maina gate failed (${message(e)}); confirm it yourself.`,
			decisionIds: [],
			degraded: true,
		};
	}
}

export async function safeSummary(
	ports: ClaudeHookPorts,
	event: SessionEvent,
): Promise<string | undefined> {
	try {
		return await ports.sessionSummary(event);
	} catch {
		return undefined;
	}
}

/** What to tell the user when this session's changes went unverified. */
const unverified = (why: string): string =>
	`${why}, so this session's changes were not verified; run maina verify yourself.`;

/** A stop that could not be verified: let through, but never silently. */
const unverifiedStop = (why: string): GateDecision => ({
	verdict: "allow",
	reason: unverified(why),
	decisionIds: [],
	degraded: true,
});

/**
 * The stop decision for the hook client's answer to a `session.stop` event
 * asked with `timeoutMs`. The runtime's answer stands, except that a stop
 * never asks; when the runtime could not answer (the client's fallback) the
 * stop is let through with a notice saying why, never as a silent `{}` that
 * would drop a failed verify (#480). Pure.
 */
export function stopFromClient(
	result: GateResult,
	timeoutMs: number,
): GateDecision {
	if (result.source === "fallback") {
		return unverifiedStop(
			result.degradedCause === "timeout"
				? `maina verify did not finish within ${timeoutMs / 1000} s`
				: `maina verify could not run (maina runtime unavailable: ${result.degradedCause})`,
		);
	}
	const { verdict, reason, decisionIds, degraded } = result;
	return {
		verdict: verdict === "ask" ? "allow" : verdict,
		reason,
		decisionIds,
		degraded,
	};
}

/** The runtime's `session.stop` event for a host's session stop. */
export function stopGateEvent(event: SessionEvent, host: string): GateEvent {
	const input = { host, sessionId: event.sessionId };
	return event.cwd === undefined
		? { kind: SESSION_STOP, input }
		: { kind: SESSION_STOP, input, cwd: event.cwd };
}

/**
 * Verify on stop through `ports.stopVerify`, or undefined without one.
 * Never rejects and never asks: a port that fails or answers with the wrong
 * shape lets the stop through with a notice.
 */
export async function safeStopVerify(
	ports: ClaudeHookPorts,
	event: GateEvent,
): Promise<GateDecision | undefined> {
	if (ports.stopVerify === undefined) return undefined;
	try {
		const decision = parseGateDecision(await ports.stopVerify(event));
		if (decision === null) {
			return unverifiedStop("maina verify gave no usable answer");
		}
		return decision.verdict === "ask"
			? { ...decision, verdict: "allow" }
			: decision;
	} catch (e) {
		return unverifiedStop(`maina verify could not run (${message(e)})`);
	}
}

/**
 * The Stop hook: verify on the session's changes and the session summary,
 * run side by side. A failed verify blocks the stop; otherwise verify's line
 * and the summary are shown together, or nothing when both are empty.
 */
async function stopHook(
	event: Extract<ClaudeEvent, { type: "session" }>,
	ports: ClaudeHookPorts,
): Promise<ClaudeHookRun> {
	const [verified, line] = await Promise.all([
		safeStopVerify(ports, stopGateEvent(event.event, "claude-code")),
		safeSummary(ports, event.event),
	]);
	if (verified?.verdict === "deny") {
		return {
			event,
			decision: verified,
			output: toClaude({ hookEvent: event.hookEvent, decision: verified }),
		};
	}
	const context =
		[verified?.reason, line].filter(Boolean).join("\n") || undefined;
	return { event, output: toClaude({ hookEvent: event.hookEvent, context }) };
}

/**
 * Runs one hook over its raw stdin. `configured` is the event the hook was
 * registered for, when the caller knows it (see `fromClaude`).
 */
export async function runClaudeHook(
	raw: string,
	ports: ClaudeHookPorts,
	configured?: string,
): Promise<ClaudeHookRun> {
	const event = fromClaude(parseHookInput(raw), configured);
	switch (event.type) {
		case "gate": {
			const decision = await safeDecision(ports, event.event);
			return {
				event,
				decision,
				output: toClaude({ hookEvent: event.hookEvent, decision }),
			};
		}
		case "malformed": {
			const decision: GateDecision = {
				verdict: "ask",
				reason: `maina could not read this hook input (${event.reason}); confirm it yourself.`,
				decisionIds: [],
				degraded: true,
			};
			return {
				event,
				decision,
				output: toClaude({ hookEvent: event.hookEvent, decision }),
			};
		}
		case "session": {
			if (event.hookEvent === "Stop") return stopHook(event, ports);
			const line = await safeSummary(ports, event.event);
			const context = [GUARDRAILS_ACTIVE, line].filter(Boolean).join(" ");
			return {
				event,
				output: toClaude({ hookEvent: event.hookEvent, context }),
			};
		}
		default:
			return { event, output: toClaude({ hookEvent: event.hookEvent }) };
	}
}
