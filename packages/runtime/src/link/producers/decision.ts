/**
 * The `decision` event (#591, spec §6.3): one per decision-log record, fed
 * by core's post-append port (`appendDecision`'s `onAppended`).
 *
 * The record's hashes, its decision type, the action taken, the answer's
 * probability in basis points and the latency. The input hash stays keyed
 * by the clone's decision-log salt, which never leaves the machine
 * (`privacy.json` `salts.device`). The question's schema, the option order,
 * the distribution and the answer itself are not sent: free-form options
 * can be hashed file paths, and the cloud needs the verdict, not them.
 */

import type { DecisionRecord, Result } from "@mainahq/core";
import type { EventInput } from "../outbox";
import type { UplinkError } from "../uplink";
import {
	count,
	type Emitted,
	type EventSink,
	emit,
	isDecisionType,
	isHash,
	isLabel,
	isOpaqueId,
	label,
	optional,
} from "./emit";

const BP = 10_000;

/** The probability the record's distribution gave its answer, in basis points. */
function confidenceBp(record: DecisionRecord): number {
	const entry = record.distribution.find((e) => e.answer === record.answer);
	const p = entry?.p ?? 0;
	return Math.min(BP, count(p * BP));
}

/** `record` as a metadata `decision` event, or null when it has no such form. */
export function decisionEvent(record: DecisionRecord): EventInput | null {
	if (
		!isDecisionType(record.type) ||
		!isHash(record.inputHash) ||
		!isHash(record.policyHash) ||
		!isHash(record.modelHash)
	) {
		return null;
	}
	return {
		type: "decision",
		data: {
			decisionType: record.type,
			inputHash: record.inputHash,
			policyHash: record.policyHash,
			modelHash: record.modelHash,
			finalAction: label(record.finalAction),
			confidenceBp: confidenceBp(record),
			latencyMs: count(record.latencyMs),
			...optional("host", record.host, isLabel),
			...optional("sessionId", record.sessionId, isOpaqueId),
		},
	};
}

export function emitDecision(
	sink: EventSink,
	record: DecisionRecord,
): Result<Emitted, UplinkError> {
	return emit(sink, decisionEvent(record));
}
