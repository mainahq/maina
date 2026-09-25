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
	parseGateDecision,
} from "./gate";

export type ClaudeHookPorts = Readonly<{
	/** The gate for one event; the hook client in production. */
	evaluate: (event: GateEvent) => Promise<GateDecision>;
	/** The one-line session summary, or undefined when there is nothing to say. */
	sessionSummary: (event: SessionEvent) => Promise<string | undefined>;
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
			})
		);
	} catch (e) {
		return {
			verdict: "ask",
			reason: `maina gate failed (${message(e)}); confirm it yourself.`,
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
			};
			return {
				event,
				decision,
				output: toClaude({ hookEvent: event.hookEvent, decision }),
			};
		}
		case "session": {
			const line = await safeSummary(ports, event.event);
			const context =
				event.hookEvent === "SessionStart"
					? [GUARDRAILS_ACTIVE, line].filter(Boolean).join(" ")
					: line;
			return {
				event,
				output: toClaude({ hookEvent: event.hookEvent, context }),
			};
		}
		default:
			return { event, output: toClaude({ hookEvent: event.hookEvent }) };
	}
}
