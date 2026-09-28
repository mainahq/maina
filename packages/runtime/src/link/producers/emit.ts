/**
 * What every Link event producer shares (#591, spec §6.3, FR-PRIV-1): the
 * sink it emits to, and the field checks that keep an event metadata-only.
 *
 * A producer turns one fact (a decision-log record, an override, a
 * receipt, a model call, an agent) into an `EventInput` and hands it to the
 * sink, the uplink's `enqueue`, which queues it only while the device is
 * enrolled and checks it against the pinned schema.
 *
 * Metadata by default: every string a producer sends is a hash, one of
 * Maina's own labels or ids, a version or a commit sha, checked here by
 * shape. A value of another shape (a path, a command, a prompt, a name) is
 * never passed on: an optional field is left out, a required label becomes
 * `unknown`, and a fact whose identity is not a real hash is not sent.
 */

import type { Result } from "@mainahq/core";
import type { EventInput } from "../outbox";
import eventSchema from "../protocol/v1/event.schema.json" with {
	type: "json",
};
import type { EnqueueResult, UplinkError } from "../uplink";

/** Where producers emit: the uplink's `enqueue`. */
export type EventSink = Readonly<{
	enqueue: (input: EventInput) => Result<EnqueueResult, UplinkError>;
}>;

export type Emitted =
	| EnqueueResult
	/** The fact had no metadata form (its hashes were not hashes). */
	| Readonly<{ queued: false; reason: "unrepresentable" }>;

/** Enqueues `input` on `sink`; a fact with no event enqueues nothing. */
export function emit(
	sink: EventSink,
	input: EventInput | null,
): Result<Emitted, UplinkError> {
	if (input === null) {
		return { ok: true, value: { queued: false, reason: "unrepresentable" } };
	}
	return sink.enqueue(input);
}

// ── Field shapes (the `event.schema.json` patterns, or stricter) ───────────

/** A Maina label: lower-case words (the schema's `label`). */
const LABEL = /^[a-z][a-z0-9_.-]{0,63}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
/** An opaque id, stricter than the schema's: no `/`, `.` or `:`, so no path or URL. */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** A version: starts with a digit (the schema's `version`, narrowed). */
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The label a required field falls back to. */
export const UNKNOWN = "unknown";

export const isLabel = (value: unknown): value is string =>
	typeof value === "string" && LABEL.test(value);

export const isHash = (value: unknown): value is string =>
	typeof value === "string" && HASH.test(value);

export const isVersion = (value: unknown): value is string =>
	typeof value === "string" && VERSION.test(value);

/** `value` when it is a label, else `unknown`. */
export const label = (value: unknown): string =>
	isLabel(value) ? value : UNKNOWN;

/** `{ [key]: value }` when `ok(value)`, else nothing: for optional fields. */
export function optional(
	key: string,
	value: unknown,
	ok: (value: unknown) => boolean,
): Readonly<Record<string, unknown>> {
	return ok(value) ? { [key]: value } : {};
}

export const isOpaqueId = (value: unknown): boolean =>
	typeof value === "string" && OPAQUE_ID.test(value);

export const isCommit = (value: unknown): boolean =>
	typeof value === "string" && COMMIT.test(value);

/**
 * The decision types the pinned schema takes (`decision` and `override`
 * share the enum), read from the schema so there is one list.
 */
const DECISION_TYPES: readonly string[] =
	eventSchema.$defs["decision.metadata"].properties.decisionType.enum;

export const isDecisionType = (value: unknown): value is string =>
	typeof value === "string" && DECISION_TYPES.includes(value);

/** A count or duration as the schema's non-negative integer. */
export function count(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
