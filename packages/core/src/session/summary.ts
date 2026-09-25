/**
 * Session summary (FR-RET-2, spec §10): what the gate and model routing did
 * in one agent session, read from a slice of the decision log, for the host
 * to show on `session.stop`:
 *
 *   maina session: 1 blocked, 2 asked, 14 allowed | 5 routed, ~$0.42 saved | +38 ms p95 | receipt: https://…
 *
 * `summarise` is `null` and `formatSessionSummary` `undefined` when the
 * session saw no gate or routing decision, so a host adapter's stop contract
 * stays silent. Pure: the caller reads the slice (`readLogSlice` with the
 * session's id) and decides where the line goes.
 */

import type { ModelTier } from "../ai/tiers";
import { type LogSlice, percentile, SHADOW_ACTION } from "../decide/evidence";
import type { DecisionRecord } from "../decide/log/schema";
import { REVERSED_SUFFIX } from "../gate/evaluate";

export type SessionSummary = Readonly<{
	/** Gate events that ended in `deny`. */
	blocked: number;
	/** Gate events that ended in `ask`, overridden or not. */
	asked: number;
	/** Gate events that ended in `allow`. */
	allowed: number;
	/** Tasks routed to a model tier (`task.tier` decisions). */
	routed: number;
	/**
	 * What routing saved against the baseline tier, in US dollars. Negative
	 * when routing picked dearer tiers on balance; 0 without routing costs.
	 */
	estimatedSavedUsd: number;
	/**
	 * Nearest-rank p95 of the latency Maina added per gate or routing event,
	 * in milliseconds (both halves of a two-order check count as one event).
	 */
	addedLatencyP95: number | null;
}>;

/**
 * Estimated cost of one task on each tier, and the tier a task would have
 * run on without routing. Supplied by the caller from its config; a tier
 * with no (or an invalid) cost adds nothing to the estimate.
 */
export type RoutingCosts = Readonly<{
	baselineTier: ModelTier;
	costPerTaskUsd: Readonly<Partial<Record<ModelTier, number>>>;
}>;

export type SummaryOptions = Readonly<{ routing?: RoutingCosts }>;

const GATE_TYPE = "action.risk";
const ROUTING_TYPE = "task.tier";

type GateCount = "blocked" | "asked" | "allowed";

const GATE_COUNTS: Readonly<Record<string, GateCount>> = {
	deny: "blocked",
	ask: "asked",
	allow: "allowed",
};

/** One gate or routing event: its primary record and its total latency. */
type Event = Readonly<{
	key: string;
	primary: DecisionRecord;
	latencyMs: number;
}>;

/** The event a served gate or routing record belongs to, if any. */
function eventKey(record: DecisionRecord): string | undefined {
	if (record.finalAction === SHADOW_ACTION) return undefined;
	if (record.type === ROUTING_TYPE) return `${ROUTING_TYPE}\u0000${record.id}`;
	if (record.type !== GATE_TYPE) return undefined;
	const id = record.id.endsWith(REVERSED_SUFFIX)
		? record.id.slice(0, -REVERSED_SUFFIX.length)
		: record.id;
	return `${GATE_TYPE}\u0000${id}`;
}

/** Served gate and routing records grouped into events, sorted by key. */
function eventsOf(decisions: readonly DecisionRecord[]): readonly Event[] {
	const groups = new Map<string, DecisionRecord[]>();
	for (const record of decisions) {
		const key = eventKey(record);
		if (key === undefined) continue;
		const group = groups.get(key) ?? [];
		group.push(record);
		groups.set(key, group);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.flatMap(([key, records]) => {
			const primary =
				records.find((r) => !r.id.endsWith(REVERSED_SUFFIX)) ?? records[0];
			if (primary === undefined) return [];
			const latencyMs = records.reduce((sum, r) => sum + r.latencyMs, 0);
			return [{ key, primary, latencyMs }];
		});
}

function validCost(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

/** Baseline cost minus the routed tier's cost; 0 when either is unknown. */
function savingOf(record: DecisionRecord, routing: RoutingCosts): number {
	const costs = routing.costPerTaskUsd;
	const baseline = validCost(costs[routing.baselineTier]);
	const tier = record.answer;
	const chosen =
		typeof tier === "string" && Object.hasOwn(costs, tier)
			? validCost(costs[tier as ModelTier])
			: undefined;
	return baseline === undefined || chosen === undefined ? 0 : baseline - chosen;
}

/**
 * Tallies the gate and routing decisions in `slice`. Shadow records are
 * left out (nothing was done with them), as are other decision types.
 * `null` when no gate or routing event happened.
 */
export function summarise(
	slice: LogSlice,
	options: SummaryOptions = {},
): SessionSummary | null {
	const counts = { blocked: 0, asked: 0, allowed: 0, routed: 0 };
	let estimatedSavedUsd = 0;
	const latencies: number[] = [];
	for (const event of eventsOf(slice.decisions)) {
		const { primary } = event;
		if (primary.type === ROUTING_TYPE) {
			counts.routed += 1;
			if (options.routing !== undefined) {
				estimatedSavedUsd += savingOf(primary, options.routing);
			}
		} else {
			const count = Object.hasOwn(GATE_COUNTS, primary.finalAction)
				? GATE_COUNTS[primary.finalAction]
				: undefined;
			// A gate record with an unknown final action tells nothing.
			if (count === undefined) continue;
			counts[count] += 1;
		}
		latencies.push(event.latencyMs);
	}
	if (latencies.length === 0) return null;
	return {
		...counts,
		estimatedSavedUsd,
		addedLatencyP95: percentile(latencies, 0.95),
	};
}

/** Printable ASCII only: no spaces, controls or look-alike characters. */
const RECEIPT_URL = /^https?:\/\/[\x21-\x7e]{1,2048}$/;

function routingPart(summary: SessionSummary): string | undefined {
	if (summary.routed === 0) return undefined;
	const cents = Math.round(Math.abs(summary.estimatedSavedUsd) * 100);
	if (!Number.isFinite(cents) || cents === 0) return `${summary.routed} routed`;
	const amount = (cents / 100).toFixed(2);
	const label = summary.estimatedSavedUsd > 0 ? "saved" : "extra";
	return `${summary.routed} routed, ~$${amount} ${label}`;
}

/**
 * The one line a host shows on `session.stop`, with the receipt link when
 * `receiptUrl` is a plain http(s) URL. `undefined` (stay silent) when
 * nothing happened.
 */
export function formatSessionSummary(
	summary: SessionSummary | null,
	receiptUrl?: string,
): string | undefined {
	if (summary === null) return undefined;
	const { blocked, asked, allowed, addedLatencyP95 } = summary;
	const parts = [
		blocked + asked + allowed > 0
			? `${blocked} blocked, ${asked} asked, ${allowed} allowed`
			: undefined,
		routingPart(summary),
		addedLatencyP95 === null
			? undefined
			: `+${Math.round(addedLatencyP95)} ms p95`,
		receiptUrl !== undefined && RECEIPT_URL.test(receiptUrl)
			? `receipt: ${receiptUrl}`
			: undefined,
	].filter((p): p is string => p !== undefined);
	return `maina session: ${parts.join(" | ")}`;
}
