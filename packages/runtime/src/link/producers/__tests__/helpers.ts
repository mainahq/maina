/**
 * Test helpers for the Link event producers (#591): a sink that captures
 * what a producer enqueues, and the check that an enqueued input is an
 * event the pinned schema accepts.
 */

import type { EventInput } from "../../outbox";
import { type LinkEvent, parseWire } from "../../protocol/wire";
import type { EventSink } from "../emit";

type CapturingSink = Readonly<{
	sink: EventSink;
	inputs: EventInput[];
}>;

/** A sink for an enrolled device: every input is queued and kept. */
export function capturingSink(): CapturingSink {
	const inputs: EventInput[] = [];
	return {
		inputs,
		sink: {
			enqueue: (input) => {
				inputs.push(input);
				return {
					ok: true,
					value: {
						queued: true,
						eventId: `evt_${inputs.length}`,
						seq: inputs.length,
					},
				};
			},
		},
	};
}

/**
 * `input` as the outbox would queue it, parsed against the published event
 * schema: the schema's refusal as an error when it does not match.
 */
export function asWireEvent(input: EventInput, seq = 1): LinkEvent {
	const parsed = parseWire("event", {
		eventId: `evt_${seq}`,
		seq,
		ts: "2026-09-28T09:00:00.000Z",
		type: input.type,
		dataClass: input.dataClass ?? "metadata",
		...(input.runId === undefined ? {} : { runId: input.runId }),
		data: input.data,
	});
	if (!parsed.ok) {
		throw new Error(
			`${input.type} does not match the pinned schema: ${parsed.error.problems.join("; ")}`,
		);
	}
	return parsed.value;
}

export const HASH_A = `sha256:${"a".repeat(64)}`;
export const HASH_B = `sha256:${"b".repeat(64)}`;
export const HASH_C = `sha256:${"c".repeat(64)}`;
