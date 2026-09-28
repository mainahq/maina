/**
 * The `receipt` event (#591, spec §6.3): a receipt's summary and hash, from
 * core's `receiptSummary`, and the commit it was made for when known.
 *
 * The receipt itself (title, findings with their file names, walkthrough)
 * stays on the machine; the hash lets the cloud match a receipt someone
 * shows it, and `passed` is the verdict.
 */

import type { ReceiptSummary, Result } from "@mainahq/core";
import type { EventInput } from "../outbox";
import type { UplinkError } from "../uplink";
import {
	type Emitted,
	type EventSink,
	emit,
	isCommit,
	isHash,
	optional,
} from "./emit";

/**
 * `summary` as a metadata `receipt` event, with `commit` when it is a full
 * sha; null when the summary's hash is not a hash.
 */
export function receiptEvent(
	summary: ReceiptSummary,
	commit?: string,
): EventInput | null {
	if (!isHash(summary.receiptHash)) return null;
	return {
		type: "receipt",
		data: {
			receiptHash: summary.receiptHash,
			passed: summary.passed === true,
			...optional("commit", commit, isCommit),
		},
	};
}

export function emitReceipt(
	sink: EventSink,
	summary: ReceiptSummary,
	commit?: string,
): Result<Emitted, UplinkError> {
	return emit(sink, receiptEvent(summary, commit));
}
