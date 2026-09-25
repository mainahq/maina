/**
 * One Cursor hook run (FR-GATE-7): raw stdin → `fromCursor` → the gate or
 * the session summary → `toCursor`. The ports are the Claude Code hook's
 * (`hook-system.ts` builds the real ones), and so are the guarantees:
 *
 * Never rejects. A payload it cannot read, a gate that throws or answers
 * with the wrong shape: each asks. A summary that fails is left out, so a
 * session start or stop is never held up by it.
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
	safeSummary,
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
			};
			return {
				event,
				decision,
				output: toCursor({ hookEvent: event.hookEvent, decision }),
			};
		}
		case "session": {
			const line = await safeSummary(ports, event.event);
			const context =
				event.hookEvent === "sessionStart"
					? [GUARDRAILS_ACTIVE, line].filter(Boolean).join(" ")
					: line;
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
