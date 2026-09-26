/**
 * Notifications (FR-RET-6, #351): `notify(event)` tells the human when
 * maina needs them, in the terminal they are in.
 *
 * Only two events notify: a gate decision that asks (a prompt that needs a
 * human) and a finished verify (pass or fail). Allows, denies and a stop
 * that verified nothing never do. The sequence is routed by `detectTerminal`:
 * Warp's documented OSC 777 notification in Warp, the generic OSC 9 or OSC
 * 777 notification in a terminal that documents one, and nothing elsewhere.
 *
 * Everything but `notify`'s `emit` is pure; `notify` never throws.
 */

import type { GateDecision } from "../gate";
import { detectTerminal, type Env } from "./detect";
import { genericSequence, type Notification } from "./generic";
import { warpSequence } from "./warp";

export type NotifyEvent =
	/** A gate decision: notifies only when it asks. */
	| Readonly<{ type: "gate"; decision: GateDecision }>
	/** Verify on session stop: notifies whenever verify ran. */
	| Readonly<{ type: "verify"; decision: GateDecision }>;

type NotifyPorts = Readonly<{
	env: Env;
	/** Writes the escape sequence where the terminal will see it. */
	emit: (sequence: string) => void;
}>;

/** What a hook run decided: the gate's answer and, on a stop, verify's. */
export type HookOutcome = Readonly<{
	decision?: GateDecision;
	verify?: GateDecision;
}>;

/** The event a hook run notifies about; verify's, when the run has one. */
export function notifyEventOf(run: HookOutcome): NotifyEvent | undefined {
	if (run.verify !== undefined) return { type: "verify", decision: run.verify };
	if (run.decision !== undefined) {
		return { type: "gate", decision: run.decision };
	}
	return undefined;
}

/** What `event` says to the human, or null when it needs no one. */
export function notificationOf(event: NotifyEvent): Notification | null {
	const { verdict, reason } = event.decision;
	if (event.type === "gate") {
		return verdict === "ask"
			? { title: "maina needs your approval", body: reason }
			: null;
	}
	// A stop with nothing to verify answers allow with no reason.
	if (reason === "") return null;
	return {
		title: verdict === "deny" ? "maina verify failed" : "maina verify finished",
		body: reason,
	};
}

/** The escape sequence for `event` in `env`'s terminal, or null for none. */
export function notificationSequence(
	event: NotifyEvent | undefined,
	env: Env,
): string | null {
	if (event === undefined) return null;
	const notification = notificationOf(event);
	if (notification === null) return null;
	const terminal = detectTerminal(env);
	switch (terminal.kind) {
		case "warp":
			return warpSequence(notification);
		case "generic":
			return genericSequence(terminal.osc, notification);
		case "none":
			return null;
		default: {
			const unreachable: never = terminal;
			return unreachable;
		}
	}
}

/** Emits `event`'s notification, if any; true when one was emitted. */
export function notify(event: NotifyEvent, ports: NotifyPorts): boolean {
	const sequence = notificationSequence(event, ports.env);
	if (sequence === null) return false;
	try {
		ports.emit(sequence);
		return true;
	} catch {
		return false;
	}
}
