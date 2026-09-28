/**
 * The device's event sequence (#590, spec §6.3): pure helpers.
 *
 * Every event gets the device's next `seq` when it is queued, whatever the
 * wall clock says, so a clock that jumps back or forward never reorders or
 * repeats one; `ts` is informational. The cloud orders by `seq`, dedupes by
 * `eventId` and finds a lost event as a gap in the seqs it has seen.
 *
 * An ack settles only the batch it answers. A held seq outside that batch
 * stays, even below `nextExpectedSeq`: a cloud ahead of the device holds
 * some event at that seq, not necessarily this one, and an event queued
 * while the batch was in flight was never sent. A lost ack's batch is the
 * oldest queued events, so the next batch resends it and the cloud dedupes.
 * Within the batch, a cloud that counted every event (accepted, duplicate
 * or rejected) holds them all; otherwise a seq below `nextExpectedSeq`
 * outside every reported gap is held and one in a gap is resent. The gap
 * list is capped (100, oldest first), so when it is full nothing past its
 * last gap is read as held. A rejected seq will never be accepted and
 * leaves. A cloud ahead lifts the device's seq, so a new event never reuses
 * a seq the cloud already has.
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

/** The most gaps an ack carries (`envelope-ack.schema.json` `maxItems`). */
const MAX_ACK_GAPS = 100;

/**
 * What an ack means for the seqs the device still `held`, given the seqs of
 * the batch it answers (`sent`).
 */
export function reconcile(
	held: readonly number[],
	sent: readonly number[],
	ack: EnvelopeAck,
): Reconciled {
	const inBatch = new Set(sent);
	const refused = new Set(ack.rejected.map((r) => r.seq));
	const whole =
		ack.accepted + ack.duplicates + ack.rejected.length >= inBatch.size;
	const lastGap = ack.gaps.at(-1);
	const horizon =
		ack.gaps.length >= MAX_ACK_GAPS && lastGap !== undefined
			? lastGap.to
			: ack.nextExpectedSeq - 1;
	const delivered: number[] = [];
	const rejected: number[] = [];
	for (const seq of held) {
		if (!inBatch.has(seq)) continue;
		if (refused.has(seq)) rejected.push(seq);
		else if (whole || (seq <= horizon && !inGaps(seq, ack.gaps))) {
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
