/**
 * The decision log record (FR-DEC-3, FR-DEC-5) and its validation. A record
 * holds hashes, Maina's own labels and numbers: never raw code, diff text or
 * paths. Free-form option strings (file paths offered to `context.select`,
 * say) are hashed unless `DecisionLogPrivacy.rawOptions` is set.
 */

import type { Result } from "../../db/index";
import { DECISION_TYPES } from "../../policy/schema";
import { SUM_EPSILON } from "../decide";
import type { Answer, DecisionType, DistributionEntry } from "../types";
import { DECISION_CATALOG } from "../types-catalog";
import { isHash } from "./hash";

export type DecisionRecord = Readonly<{
	/** Caller-chosen unique id of this log entry. */
	id: string;
	/** Milliseconds since the Unix epoch. */
	ts: number;
	type: DecisionType;
	/** Hash of the type, the decision state and the question id. */
	inputHash: string;
	/** Hash of the question's shape (kind, options in order, bounds). */
	schemaHash: string;
	/** The options in the order they were offered (labels or hashes). */
	optionOrder: readonly Answer[];
	policyHash: string;
	modelHash: string;
	distribution: readonly DistributionEntry[];
	answer: Answer;
	/** What the caller did with the answer, as a label (`flag`, `allow`, ...). */
	finalAction: string;
	latencyMs: number;
	/** The agent host, as a label (`claude-code`, `cursor`, ...). */
	host?: string;
	sessionId?: string;
}>;

/** How much the log may keep in the clear. Set from policy by the caller. */
export type DecisionLogPrivacy = Readonly<{
	/** Store free-form option strings as-is instead of hashing them. */
	rawOptions: boolean;
}>;

export const DEFAULT_LOG_PRIVACY: DecisionLogPrivacy = { rawOptions: false };

export type DecisionRecordField = keyof DecisionRecord | "decision";

export type DecisionLogError =
	| Readonly<{
			kind: "invalid_record";
			field: DecisionRecordField;
			message: string;
	  }>
	| Readonly<{ kind: "invalid_filter"; message: string }>
	| Readonly<{ kind: "db"; message: string }>
	| Readonly<{ kind: "corrupt_row"; id: string; message: string }>;

/** Log entry and session ids: short, no whitespace or slashes. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** Labels chosen by Maina code: lower-case words. */
export const LABEL_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

export function isDecisionType(value: unknown): value is DecisionType {
	return (
		typeof value === "string" &&
		(DECISION_TYPES as readonly string[]).includes(value)
	);
}

function isAnswerFor(
	value: unknown,
	type: DecisionType,
	privacy: DecisionLogPrivacy,
): value is Answer {
	switch (typeof value) {
		case "boolean":
			return true;
		case "number":
			return Number.isFinite(value);
		case "string": {
			// A type with fixed options takes only those, whatever the privacy:
			// `rawOptions` is about free-form options, not the catalog contract.
			const fixed = DECISION_CATALOG[type].options;
			if (fixed !== undefined) return fixed.includes(value);
			return privacy.rawOptions || isHash(value);
		}
		default:
			return false;
	}
}

function isEntryFor(
	value: unknown,
	type: DecisionType,
	privacy: DecisionLogPrivacy,
): value is DistributionEntry {
	if (typeof value !== "object" || value === null) return false;
	const { answer, p } = value as Readonly<Record<string, unknown>>;
	return (
		isAnswerFor(answer, type, privacy) &&
		typeof p === "number" &&
		Number.isFinite(p) &&
		p >= 0 &&
		p <= 1
	);
}

/**
 * Which field is inconsistent, if any: `distribution` must be one entry per
 * option in `optionOrder` order summing to 1 (or, with no options, a single
 * point mass at a numeric answer), and `answer` one of its modes. The same
 * contract `decide` enforces, checked on the (possibly hashed) labels.
 */
function inconsistency(
	optionOrder: readonly Answer[],
	distribution: readonly DistributionEntry[],
	answer: Answer,
): Readonly<{ field: DecisionRecordField; message: string }> | undefined {
	const total = distribution.reduce((sum, e) => sum + e.p, 0);
	if (distribution.length === 0 || Math.abs(total - 1) > SUM_EPSILON) {
		return {
			field: "distribution",
			message: "distribution must be non-empty and sum to 1",
		};
	}
	if (optionOrder.length === 0) {
		const [only] = distribution;
		if (distribution.length !== 1 || typeof only?.answer !== "number") {
			return {
				field: "distribution",
				message: "a score distribution is a single numeric entry",
			};
		}
		return only.answer === answer
			? undefined
			: { field: "answer", message: "a score answer is its point mass" };
	}
	if (
		distribution.length !== optionOrder.length ||
		distribution.some((e, i) => e.answer !== optionOrder[i])
	) {
		return {
			field: "distribution",
			message: "distribution needs one entry per option, in option order",
		};
	}
	const chosen = distribution.find((e) => e.answer === answer);
	const max = Math.max(...distribution.map((e) => e.p));
	return chosen !== undefined && chosen.p === max
		? undefined
		: { field: "answer", message: "answer must be a mode of the distribution" };
}

function invalid(
	field: DecisionRecordField,
	message: string,
): Result<never, DecisionLogError> {
	return { ok: false, error: { kind: "invalid_record", field, message } };
}

/**
 * Checks every field of `value` (which may come from a caller or a database
 * row) and returns a clean copy with only the record's fields. Strings that
 * are neither hashes, fixed catalog options nor labels are rejected, so raw
 * content cannot reach the log by accident.
 */
export function validateRecord(
	value: unknown,
	privacy: DecisionLogPrivacy = DEFAULT_LOG_PRIVACY,
): Result<DecisionRecord, DecisionLogError> {
	if (typeof value !== "object" || value === null) {
		return invalid("decision", "record must be an object");
	}
	const r = value as Readonly<Record<string, unknown>>;
	if (typeof r.id !== "string" || !ID_PATTERN.test(r.id)) {
		return invalid("id", "id must be 1-128 characters of [A-Za-z0-9_.:-]");
	}
	if (typeof r.ts !== "number" || !Number.isSafeInteger(r.ts) || r.ts < 0) {
		return invalid("ts", "ts must be a non-negative integer (epoch ms)");
	}
	if (!isDecisionType(r.type)) {
		return invalid("type", "type must be a known decision type");
	}
	const type = r.type;
	for (const field of [
		"inputHash",
		"schemaHash",
		"policyHash",
		"modelHash",
	] as const) {
		if (!isHash(r[field]))
			return invalid(field, `${field} must be a sha256 hash`);
	}
	if (
		!Array.isArray(r.optionOrder) ||
		!Array.from(r.optionOrder).every((o: unknown) =>
			isAnswerFor(o, type, privacy),
		)
	) {
		return invalid(
			"optionOrder",
			"options must be booleans, numbers, fixed catalog options or hashes",
		);
	}
	if (
		!Array.isArray(r.distribution) ||
		!Array.from(r.distribution).every((e: unknown) =>
			isEntryFor(e, type, privacy),
		)
	) {
		return invalid(
			"distribution",
			"distribution must be { answer, p } entries with p in [0, 1]",
		);
	}
	if (!isAnswerFor(r.answer, type, privacy)) {
		return invalid(
			"answer",
			"answer must be a boolean, a number, a fixed catalog option or a hash",
		);
	}
	const mismatch = inconsistency(
		r.optionOrder as readonly Answer[],
		r.distribution as readonly DistributionEntry[],
		r.answer,
	);
	if (mismatch !== undefined) return invalid(mismatch.field, mismatch.message);
	if (typeof r.finalAction !== "string" || !LABEL_PATTERN.test(r.finalAction)) {
		return invalid("finalAction", "finalAction must be a lower-case label");
	}
	if (
		typeof r.latencyMs !== "number" ||
		!Number.isFinite(r.latencyMs) ||
		r.latencyMs < 0
	) {
		return invalid("latencyMs", "latencyMs must be a non-negative number");
	}
	if (
		r.host !== undefined &&
		(typeof r.host !== "string" || !LABEL_PATTERN.test(r.host))
	) {
		return invalid("host", "host must be a lower-case label");
	}
	if (
		r.sessionId !== undefined &&
		(typeof r.sessionId !== "string" || !ID_PATTERN.test(r.sessionId))
	) {
		return invalid(
			"sessionId",
			"sessionId must be 1-128 characters of [A-Za-z0-9_.:-]",
		);
	}
	const record: DecisionRecord = {
		id: r.id,
		ts: r.ts,
		type,
		inputHash: r.inputHash as string,
		schemaHash: r.schemaHash as string,
		optionOrder: [...(r.optionOrder as readonly Answer[])],
		policyHash: r.policyHash as string,
		modelHash: r.modelHash as string,
		distribution: (r.distribution as readonly DistributionEntry[]).map((e) => ({
			answer: e.answer,
			p: e.p,
		})),
		answer: r.answer,
		finalAction: r.finalAction,
		latencyMs: r.latencyMs,
		...(r.host === undefined ? {} : { host: r.host }),
		...(r.sessionId === undefined ? {} : { sessionId: r.sessionId }),
	};
	return { ok: true, value: record };
}
