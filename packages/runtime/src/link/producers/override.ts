/**
 * The `override` event (#591, spec §6.3): one per gate override, fed by
 * core's `recordOverride` port (`onOverride`), which reports an override
 * the first time it is recorded.
 *
 * The decision type, the action the host was told, the action the user
 * chose and why, as labels. The local decision id and the command, path or
 * URL behind the override stay on the machine.
 */

import type { OverrideFact, Result } from "@mainahq/core";
import type { EventInput } from "../outbox";
import type { UplinkError } from "../uplink";
import {
	type Emitted,
	type EventSink,
	emit,
	isDecisionType,
	label,
} from "./emit";

/** `fact` as a metadata `override` event, or null when it has no such form. */
export function overrideEvent(fact: OverrideFact): EventInput | null {
	if (!isDecisionType(fact.decisionType)) return null;
	return {
		type: "override",
		data: {
			decisionType: fact.decisionType,
			fromAction: label(fact.fromAction),
			toAction: label(fact.toAction),
			reason: label(fact.reason),
		},
	};
}

export function emitOverride(
	sink: EventSink,
	fact: OverrideFact,
): Result<Emitted, UplinkError> {
	return emit(sink, overrideEvent(fact));
}
