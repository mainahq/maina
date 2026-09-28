/**
 * The outbox bound (#590): pure policy over the queued entries.
 *
 * Events older than the age bound expire. Past the count or byte bound the
 * oldest `run.step` events (progress ticks, the lowest priority) are
 * coalesced away first, down to 90% of the bound; only when none are left
 * do the oldest other events go. Each drop becomes a gap marker naming its
 * seqs, its reason and its event types, so nothing audit-relevant
 * disappears silently.
 */

import type { LinkEvent, LinkEventType } from "./protocol/wire";
import { type SeqRange, toRanges } from "./sequence";

export type OutboxBounds = Readonly<{
	maxEvents: number;
	/** Of sealed journal lines. */
	maxBytes: number;
	maxAgeMs: number;
}>;

/** A drop past the bound, a rejection or an expiry. */
type GapReason = "coalesced" | "overflow" | "expired" | "rejected";

export type GapMarker = Readonly<{
	ranges: readonly SeqRange[];
	reason: GapReason;
	count: number;
	types: Readonly<Partial<Record<LinkEventType, number>>>;
	at: string;
}>;

/** A queued event, when it was queued, and its sealed line's size. */
export type Entry = Readonly<{
	event: LinkEvent;
	queuedAt: number;
	bytes: number;
}>;

export type Eviction = Readonly<{
	reason: GapReason;
	entries: readonly Entry[];
}>;

/** Gap markers kept in the status; older ones are the cloud's to report. */
const MAX_MARKERS = 256;
const LOW_WATER = 0.9;

function countTypes(
	entries: readonly Entry[],
): Partial<Record<LinkEventType, number>> {
	const types: Partial<Record<LinkEventType, number>> = {};
	for (const e of entries) types[e.event.type] = (types[e.event.type] ?? 0) + 1;
	return types;
}

export function marker(
	reason: GapReason,
	entries: readonly Entry[],
	now: Date,
): GapMarker {
	return {
		ranges: toRanges(entries.map((e) => e.event.seq)),
		reason,
		count: entries.length,
		types: countTypes(entries),
		at: now.toISOString(),
	};
}

/**
 * What must go before an event of `incomingBytes` joins `entries`: the
 * expired ones, then (past a bound) the oldest `run.step` events and, only
 * if still over, the oldest of the rest, down to the low-water mark.
 */
export function planEviction(
	entries: readonly Entry[],
	incomingBytes: number,
	bounds: OutboxBounds,
	now: number,
): readonly Eviction[] {
	const expired = entries.filter((e) => now - e.queuedAt > bounds.maxAgeMs);
	const gone = new Set(expired);
	let live = entries.filter((e) => !gone.has(e));
	let count = live.length + 1;
	let bytes = live.reduce((n, e) => n + e.bytes, incomingBytes);
	const plan: Eviction[] = [];
	if (expired.length > 0) plan.push({ reason: "expired", entries: expired });
	if (count <= bounds.maxEvents && bytes <= bounds.maxBytes) return plan;

	const targetCount = Math.max(1, Math.floor(bounds.maxEvents * LOW_WATER));
	const targetBytes = Math.floor(bounds.maxBytes * LOW_WATER);
	const over = (): boolean => count > targetCount || bytes > targetBytes;
	const take = (pick: (e: Entry) => boolean): Entry[] => {
		const taken: Entry[] = [];
		for (const e of live) {
			if (!over()) break;
			if (!pick(e)) continue;
			taken.push(e);
			count--;
			bytes -= e.bytes;
		}
		const out = new Set(taken);
		live = live.filter((e) => !out.has(e));
		return taken;
	};
	const steps = take((e) => e.event.type === "run.step");
	if (steps.length > 0) plan.push({ reason: "coalesced", entries: steps });
	const rest = take(() => true);
	if (rest.length > 0) plan.push({ reason: "overflow", entries: rest });
	return plan;
}

export function removeRanges(
	entries: readonly Entry[],
	ranges: readonly SeqRange[],
): Entry[] {
	return entries.filter(
		(e) => !ranges.some(([a, b]) => e.event.seq >= a && e.event.seq <= b),
	);
}

export function keepMarkers(markers: readonly GapMarker[]): GapMarker[] {
	return markers.slice(Math.max(0, markers.length - MAX_MARKERS));
}
