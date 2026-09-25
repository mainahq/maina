/**
 * One Cursor hook run (FR-GATE-7): raw stdin → `fromCursor` → the gate or
 * the session summary → `toCursor`. The ports are the Claude Code hook's
 * (`hook-system.ts` builds the real ones), and so are the guarantees:
 *
 * Never rejects. A payload it cannot read, a gate that throws or answers
 * with the wrong shape: each asks, which `toCursor` renders as a deny on
 * preToolUse, where Cursor does not enforce `ask` (#469). A summary that
 * fails is left out, so a session start is never held up by it; a stop
 * does not read it at all, but runs verify on the session's changes.
 */

import {
	type CursorEvent,
	type CursorOutput,
	fromCursor,
	toCursor,
} from "./adapters/cursor";
import {
	type ClaudeHookPorts,
	GUARDRAILS_ACTIVE,
	parseHookInput,
	safeDecision,
	safeStopVerify,
	safeSummary,
	stopGateEvent,
} from "./claude-hook";
import type { GateDecision } from "./gate";

type CursorHookRun = Readonly<{
	event: CursorEvent;
	/** The gate's decision for a gated event (asks for a malformed one). */
	decision?: GateDecision;
	output: CursorOutput;
}>;

/** Runs the hook registered for Cursor event `hookEvent` over its raw stdin. */
export async function runCursorHook(
	raw: string,
	ports: ClaudeHookPorts,
	hookEvent: string,
): Promise<CursorHookRun> {
	const event = fromCursor(hookEvent, parseHookInput(raw));
	switch (event.type) {
		case "gate": {
			const decision = await safeDecision(ports, event.event);
			return {
				event,
				decision,
				output: toCursor({ hookEvent: event.hookEvent, decision }),
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
				output: toCursor({ hookEvent: event.hookEvent, decision }),
			};
		}
		case "session": {
			// Cursor's stop output has no field for the summary, so only a
			// session start reads the decision log. A stop runs verify (#480):
			// a failure is a follow-up for the agent; any other line (a notice
			// that verify could not run) goes to stderr, Cursor's hook log.
			if (event.hookEvent === "stop") {
				const verified = await safeStopVerify(
					ports,
					stopGateEvent(event.event, "cursor"),
				);
				const output = toCursor({
					hookEvent: event.hookEvent,
					decision: verified,
				});
				return verified === undefined ||
					verified.verdict === "deny" ||
					verified.reason === ""
					? { event, output }
					: { event, output: { ...output, stderr: `${verified.reason}\n` } };
			}
			const line = await safeSummary(ports, event.event);
			const context = [GUARDRAILS_ACTIVE, line].filter(Boolean).join(" ");
			return {
				event,
				output: toCursor({ hookEvent: event.hookEvent, context }),
			};
		}
		case "edit":
		case "ignored":
			return { event, output: toCursor({ hookEvent: event.hookEvent }) };
		default: {
			const unreachable: never = event;
			return unreachable;
		}
	}
}
