/**
 * The device's event sequence (#590, spec §6.3): pure helpers.
 *
 * Every event gets the device's next `seq` when it is queued, whatever the
 * wall clock says, so a clock that jumps back or forward never reorders or
 * repeats one; `ts` is informational. The cloud orders by `seq`, dedupes by
 * `eventId` and finds a lost event as a gap in the seqs it has seen.
 *
 * An ack is read against what the device still holds, not just the batch it
 * answers: a seq below `nextExpectedSeq` outside every reported gap is held
 * by the cloud (a lost ack's batch included); a seq in a gap is resent; a
 * rejected seq will never be accepted and leaves. A cloud ahead of the
 * device (after a restore, say) lifts the device's seq, so a new event never
 * reuses a seq the cloud already has.
 */

import type { EnvelopeAck } from "./protocol/wire";

/** Inclusive `[from, to]`. */
export type SeqRange = readonly [number, number];

/** Sorted, distinct seqs folded into inclusive ranges. */
export function toRanges(seqs: readonly number[]): SeqRange[] {
	const sorted = [...new Set(seqs)].sort((a, b) => a - b);
	const ranges: [number, number][] = [];
	for (const s of sorted) {
		const last = ranges.at(-1);
		if (last !== undefined && last[1] + 1 === s) last[1] = s;
		else ranges.push([s, s]);
	}
	return ranges;
}

function inGaps(seq: number, gaps: EnvelopeAck["gaps"]): boolean {
	return gaps.some((g) => seq >= g.from && seq <= g.to);
}

type Reconciled = Readonly<{
	/** Held seqs the cloud has. */
	delivered: readonly number[];
	/** Held seqs the cloud refused for good. */
	rejected: readonly number[];
	/** The device's seq must be at least this. */
	floor: number;
}>;

/** What an ack means for the seqs the device still `held`. */
export function reconcile(
	held: readonly number[],
	ack: EnvelopeAck,
): Reconciled {
	const refused = new Set(ack.rejected.map((r) => r.seq));
	const delivered: number[] = [];
	const rejected: number[] = [];
	for (const seq of held) {
		if (refused.has(seq)) rejected.push(seq);
		else if (seq < ack.nextExpectedSeq && !inGaps(seq, ack.gaps)) {
			delivered.push(seq);
		}
	}
	return { delivered, rejected, floor: ack.nextExpectedSeq - 1 };
}

/** Exponential backoff with equal jitter: `random()` in [0, 1). */
export function backoffDelay(
	failures: number,
	policy: Readonly<{ baseMs: number; maxMs: number }>,
	random: () => number,
): number {
	const exp = policy.baseMs * 2 ** Math.max(0, Math.min(failures - 1, 30));
	const capped = Math.min(policy.maxMs, exp);
	return Math.round(capped / 2 + (capped / 2) * random());
}
