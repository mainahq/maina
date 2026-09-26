/**
 * The gate message a host adapter shows for a gate `ask` or `deny` (#497):
 * core's `formatGateMessage` line, with the decision id to override by
 * (`override: maina allow <id> [--always]`). Pure.
 *
 * Ids arrive over the wire, so one that is not a plain token is never
 * offered as a terminal command: the line falls back to the no-id hint,
 * banded as it would have been with the id.
 */

import { formatGateMessage } from "@mainahq/core";
import type { GateDecision } from "../gate";

/** A decision id safe to paste into a terminal. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

/** The id `maina allow` takes for `decision`, when it is safe to offer. */
export function overrideId(decision: GateDecision): string | undefined {
	const [id] = decision.decisionIds;
	return id !== undefined && PLAIN_ID.test(id) ? id : undefined;
}

/** The one-line gate message for `decision`. */
export function gateMessage(decision: GateDecision): string {
	if (decision.decisionIds.length === 0 || overrideId(decision) !== undefined) {
		return formatGateMessage(decision);
	}
	// Dropping the unsafe id must not lift the band: a decision with an id
	// and no confidence bands `low`, which confidence 0 keeps.
	return formatGateMessage({
		...decision,
		decisionIds: [],
		confidence: decision.confidence ?? 0,
	});
}
