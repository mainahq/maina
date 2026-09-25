/**
 * Stable hashes for the decision log (FR-DEC-3). Every hash is
 * `sha256:<64 hex>` over a canonical JSON encoding: object keys sorted,
 * no whitespace, and tagged forms for values plain JSON cannot represent,
 * so the same value hashes the same in every run and every process.
 */

import { createHash } from "node:crypto";
import type { Policy } from "../../policy/schema";
import type {
	DecisionBackend,
	DecisionState,
	DecisionType,
	Question,
} from "../types";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Bumped only when a preimage below changes shape; old hashes then differ. */
const PREIMAGE_VERSION = 1;

/** `true` when `value` is a hash this module produced. */
export function isHash(value: unknown): value is string {
	return typeof value === "string" && HASH_PATTERN.test(value);
}

function tagged(tag: string, value: string): string {
	return `{${JSON.stringify(tag)}:${value}}`;
}

/**
 * Object keys starting with `$` get one more `$`, so a plain object such as
 * `{ $date: "..." }` can never encode like a tagged form (`$date`, `$set`, ...).
 */
function escapeKey(key: string): string {
	return key.startsWith("$") ? `$${key}` : key;
}

function encode(value: unknown, seen: ReadonlySet<object>): string | undefined {
	switch (typeof value) {
		case "string":
			return JSON.stringify(value);
		case "boolean":
			return value ? "true" : "false";
		case "number":
			return Number.isFinite(value)
				? JSON.stringify(value)
				: tagged("$number", JSON.stringify(String(value)));
		case "bigint":
			return tagged("$bigint", JSON.stringify(value.toString()));
		case "undefined":
		case "function":
		case "symbol":
			return undefined;
		case "object":
			return value === null ? "null" : encodeObject(value, seen);
		default:
			return undefined;
	}
}

function encodeList(
	values: readonly unknown[],
	seen: ReadonlySet<object>,
): string {
	// Array.from visits holes (as undefined), so a sparse array encodes as JSON.
	return `[${Array.from(values, (v) => encode(v, seen) ?? "null").join(",")}]`;
}

function sortedEncodings(
	values: Iterable<unknown>,
	seen: ReadonlySet<object>,
): string {
	const parts = [...values].map((v) => encode(v, seen) ?? "null").sort();
	return `[${parts.join(",")}]`;
}

/**
 * A throwing getter or a revoked `Proxy` must not break logging: such an
 * object encodes as a fixed tag instead.
 */
function encodeObject(value: object, outer: ReadonlySet<object>): string {
	try {
		return encodeReadable(value, outer);
	} catch {
		return tagged("$unreadable", "true");
	}
}

function encodeReadable(value: object, outer: ReadonlySet<object>): string {
	if (outer.has(value)) return tagged("$circular", "true");
	const seen = new Set(outer).add(value);
	if (Array.isArray(value)) return encodeList(value, seen);
	if (value instanceof Date) {
		const time = value.getTime();
		return tagged(
			"$date",
			Number.isNaN(time) ? "null" : JSON.stringify(value.toISOString()),
		);
	}
	if (value instanceof Uint8Array) {
		return tagged("$bytes", JSON.stringify(Buffer.from(value).toString("hex")));
	}
	if (value instanceof Map) {
		const entries = [...value.entries()].map(([k, v]) => [k, v] as const);
		return tagged("$map", sortedEncodings(entries, seen));
	}
	if (value instanceof Set) return tagged("$set", sortedEncodings(value, seen));
	const fields = Object.keys(value)
		.sort()
		.flatMap((key) => {
			const encoded = encode((value as Record<string, unknown>)[key], seen);
			return encoded === undefined
				? []
				: [`${JSON.stringify(escapeKey(key))}:${encoded}`];
		});
	return `{${fields.join(",")}}`;
}

/**
 * Canonical JSON: sorted keys, no whitespace. `undefined`, functions and
 * symbols are dropped from objects and become `null` in arrays (as in
 * JSON); bigints, non-finite numbers, dates, bytes, maps, sets and cycles
 * get tagged forms instead of throwing (as do objects whose properties
 * cannot be read); object keys starting with `$` are
 * escaped so no plain object encodes like a tagged form. Never throws.
 */
export function canonicalJson(value: unknown): string {
	return encode(value, new Set()) ?? "null";
}

/** `sha256:<hex>` of `canonicalJson(value)`. */
export function hashValue(value: unknown): string {
	const digest = createHash("sha256")
		.update(canonicalJson(value))
		.digest("hex");
	return `sha256:${digest}`;
}

/** What a decision was made over: its type, the state and the question id. */
export function hashInput(
	type: DecisionType,
	state: DecisionState,
	questionId: string,
): string {
	return hashValue({
		v: PREIMAGE_VERSION,
		kind: "input",
		type,
		questionId,
		state,
	});
}

/** The shape of the question asked (its options in order), not its id. */
export function hashSchema(type: DecisionType, question: Question): string {
	const shape =
		question.kind === "choice"
			? { kind: question.kind, options: question.options }
			: question.kind === "score"
				? { kind: question.kind, min: question.min, max: question.max }
				: { kind: question.kind };
	return hashValue({
		v: PREIMAGE_VERSION,
		kind: "schema",
		type,
		question: shape,
	});
}

/** The whole effective policy the backend saw. */
export function hashPolicy(policy: Policy): string {
	return hashValue({ v: PREIMAGE_VERSION, kind: "policy", policy });
}

/** The backend (and, for System 1, the model) that answered. */
export function hashModel(
	backend: Readonly<{ id: DecisionBackend; version: string }>,
): string {
	return hashValue({
		v: PREIMAGE_VERSION,
		kind: "model",
		id: backend.id,
		version: backend.version,
	});
}

/**
 * A string that is safe to log as-is, or its hash. Only the decision type's
 * fixed catalog options (Maina's own labels) pass through unless `raw`;
 * anything else (a path, a code snippet) is hashed.
 */
export function redactLabel(
	value: string,
	fixedOptions: readonly string[] | undefined,
	raw: boolean,
): string {
	return raw || isHash(value) || fixedOptions?.includes(value)
		? value
		: hashValue(value);
}
