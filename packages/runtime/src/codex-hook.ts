/**
 * One Codex hook run (FR-GATE-7; mainahq/maina#475): raw stdin →
 * `fromCodex` → the gate for every action, or the session summary →
 * `toCodex`. The ports are the Claude Code hook's (`hook-system.ts` builds
 * the real ones), and so are the guarantees:
 *
 * Never rejects. A payload it cannot read, a gate that throws or answers
 * with the wrong shape: each asks, which `toCodex` turns into a deny on
 * PreToolUse. A summary that fails is left out.
 *
 * An `apply_patch` is one gate event per file it writes. They are checked
 * in order and the strictest verdict wins (deny, then ask, then allow), so
 * one file maina would not allow blocks the whole patch; a deny ends the
 * check early.
 */

import {
	type CodexEvent,
	type CodexOutput,
	fromCodex,
	toCodex,
} from "./adapters/codex";
import {
	type ClaudeHookPorts,
	GUARDRAILS_ACTIVE,
	parseHookInput,
	safeDecision,
	safeSummary,
} from "./claude-hook";
import type { GateDecision, GateEvent } from "./gate";

type CodexHookRun = Readonly<{
	event: CodexEvent;
	/** The gate's decision for a gated event (asks for a malformed one). */
	decision?: GateDecision;
	output: CodexOutput;
}>;

const RANK: Readonly<Record<GateDecision["verdict"], number>> = {
	allow: 0,
	ask: 1,
	deny: 2,
};

/**
 * The decisions for one action's events as one: the strictest verdict, the
 * reasons behind it, every decision id, and degraded when any part was.
 */
function strictest(decisions: readonly GateDecision[]): GateDecision {
	const top = decisions.reduce<GateDecision["verdict"]>(
		(v, d) => (RANK[d.verdict] > RANK[v] ? d.verdict : v),
		"allow",
	);
	const reasons = [
		...new Set(decisions.filter((d) => d.verdict === top).map((d) => d.reason)),
	];
	return {
		verdict: top,
		reason: reasons.join("; "),
		decisionIds: decisions.flatMap((d) => d.decisionIds),
		degraded: decisions.some((d) => d.degraded),
	};
}

/** Each event through the gate, in order, until one denies. */
async function evaluateAll(
	ports: ClaudeHookPorts,
	events: readonly GateEvent[],
): Promise<GateDecision> {
	const decisions: GateDecision[] = [];
	for (const event of events) {
		const decision = await safeDecision(ports, event);
		decisions.push(decision);
		if (decision.verdict === "deny") break;
	}
	if (decisions.length === 0) {
		return {
			verdict: "ask",
			reason: "maina found no action to check; confirm it yourself.",
			decisionIds: [],
			degraded: true,
		};
	}
	return strictest(decisions);
}

/** Runs the hook registered for Codex event `hookEvent` over its raw stdin. */
export async function runCodexHook(
	raw: string,
	ports: ClaudeHookPorts,
	hookEvent: string,
): Promise<CodexHookRun> {
	const event = fromCodex(hookEvent, parseHookInput(raw));
	switch (event.type) {
		case "gate": {
			const decision = await evaluateAll(ports, event.events);
			return {
				event,
				decision,
				output: toCodex({ hookEvent: event.hookEvent, decision }),
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
				output: toCodex({ hookEvent: event.hookEvent, decision }),
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
				output: toCodex({ hookEvent: event.hookEvent, context }),
			};
		}
		case "ignored":
			return { event, output: toCodex({ hookEvent: event.hookEvent }) };
		default: {
			const unreachable: never = event;
			return unreachable;
		}
	}
}
