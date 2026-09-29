/**
 * Opt-in outcome sharing (FR-DEC-7, FR-PRIV-2). When the user turns on
 * `telemetry.outcome_sharing`, each (decision, outcome) pair can be shared as
 * a small payload: the decision's type, model hash, answer (only when it is a
 * boolean, a number or a fixed catalog option), confidence, final action,
 * latency and host, plus the outcome label.
 *
 * Never shared: ids, timestamps, the input and schema hashes, the options
 * and distribution (free-form options can be paths, hashed or raw), the
 * session id, the outcome's source and ref. The payload is re-validated
 * against that closed shape before it is sent.
 */

import type { Result } from "../db/index";
import { isHash } from "../decide/log/hash";
import {
	type DecisionRecord,
	isDecisionType,
	LABEL_PATTERN,
} from "../decide/log/schema";
import {
	OUTCOMES,
	type Outcome,
	type OutcomeRecord,
} from "../decide/outcomes/types";
import type { Answer, DecisionType } from "../decide/types";
import { DECISION_CATALOG } from "../decide/types-catalog";
import type { NetworkError, NetworkPort } from "../ports/network";
import { loadCollectionConfig, type TelemetryContext } from "./consent";

export const OUTCOME_SHARE_VERSION = 1;

export type SharedDecision = Readonly<{
	type: DecisionType;
	modelHash: string;
	/** Omitted when the answer is a free-form (possibly path-derived) string. */
	answer?: boolean | number | string;
	/** Probability the backend gave the answer, in [0, 1]. */
	confidence: number;
	finalAction: string;
	/** Whole milliseconds. */
	latencyMs: number;
	host?: string;
}>;

export type OutcomeSharePayload = Readonly<{
	v: typeof OUTCOME_SHARE_VERSION;
	decision: SharedDecision;
	outcome: Outcome;
}>;

export type OutcomeShareError =
	| Readonly<{ kind: "mismatch"; message: string }>
	| Readonly<{ kind: "invalid_payload"; field: string; message: string }>
	/**
	 * A request failed and the share stopped there. `sent` counts the
	 * outcomes of the earlier requests the server acknowledged; none after
	 * the failed one were sent. An HTTP error means the failed request
	 * stored nothing; a timeout or transport error leaves it unknown, so
	 * `sent` is then a lower bound. `payload_too_large` is a 413 (over the
	 * item or byte cap) and `rate_limited` a 429.
	 */
	| Readonly<{
			kind: "network" | "payload_too_large" | "rate_limited";
			error: NetworkError;
			sent: number;
	  }>;

export type ShareResult = Readonly<
	{ sent: 0; skipped: "not_opted_in" } | { sent: number }
>;

export type OutcomeSharePorts = TelemetryContext &
	Readonly<{ network: NetworkPort }>;

export type ShareOptions = Readonly<{
	baseUrl: string;
	timeoutMs?: number;
}>;

const DECISION_KEYS = new Set([
	"type",
	"modelHash",
	"answer",
	"confidence",
	"finalAction",
	"latencyMs",
	"host",
]);
const PAYLOAD_KEYS = new Set(["v", "decision", "outcome"]);

/** True for answers that are Maina's own labels rather than caller content. */
function isShareableAnswer(type: DecisionType, answer: unknown): boolean {
	if (typeof answer === "boolean") return true;
	if (typeof answer === "number") return Number.isFinite(answer);
	if (typeof answer !== "string") return false;
	return DECISION_CATALOG[type].options?.includes(answer) ?? false;
}

function confidenceOf(decision: DecisionRecord): number {
	return (
		decision.distribution.find((entry) => entry.answer === decision.answer)
			?.p ?? 0
	);
}

function invalid(
	field: string,
	message: string,
): Result<never, OutcomeShareError> {
	return { ok: false, error: { kind: "invalid_payload", field, message } };
}

function extraKey(
	value: Readonly<Record<string, unknown>>,
	allowed: ReadonlySet<string>,
): string | undefined {
	return Object.keys(value).find((key) => !allowed.has(key));
}

function validateDecision(
	value: unknown,
): Result<SharedDecision, OutcomeShareError> {
	if (typeof value !== "object" || value === null) {
		return invalid("decision", "decision must be an object");
	}
	const d = value as Readonly<Record<string, unknown>>;
	const extra = extraKey(d, DECISION_KEYS);
	if (extra !== undefined) {
		return invalid(`decision.${extra}`, "field is not part of the payload");
	}
	if (!isDecisionType(d.type)) {
		return invalid("decision.type", "type must be a known decision type");
	}
	if (!isHash(d.modelHash)) {
		return invalid("decision.modelHash", "modelHash must be a sha256 hash");
	}
	if (d.answer !== undefined && !isShareableAnswer(d.type, d.answer)) {
		return invalid(
			"decision.answer",
			"answer must be a boolean, a number or a fixed catalog option",
		);
	}
	if (
		typeof d.confidence !== "number" ||
		!(d.confidence >= 0 && d.confidence <= 1)
	) {
		return invalid("decision.confidence", "confidence must be in [0, 1]");
	}
	if (typeof d.finalAction !== "string" || !LABEL_PATTERN.test(d.finalAction)) {
		return invalid("decision.finalAction", "finalAction must be a label");
	}
	if (
		typeof d.latencyMs !== "number" ||
		!Number.isSafeInteger(d.latencyMs) ||
		d.latencyMs < 0
	) {
		return invalid(
			"decision.latencyMs",
			"latencyMs must be a non-negative integer",
		);
	}
	if (
		d.host !== undefined &&
		(typeof d.host !== "string" || !LABEL_PATTERN.test(d.host))
	) {
		return invalid("decision.host", "host must be a label");
	}
	return {
		ok: true,
		value: {
			type: d.type,
			modelHash: d.modelHash,
			...(d.answer === undefined ? {} : { answer: d.answer as Answer }),
			confidence: d.confidence,
			finalAction: d.finalAction,
			latencyMs: d.latencyMs,
			...(d.host === undefined ? {} : { host: d.host as string }),
		},
	};
}

/** Checks `value` against the closed payload shape; returns a clean copy. */
export function validateOutcomeSharePayload(
	value: unknown,
): Result<OutcomeSharePayload, OutcomeShareError> {
	if (typeof value !== "object" || value === null) {
		return invalid("payload", "payload must be an object");
	}
	const p = value as Readonly<Record<string, unknown>>;
	const extra = extraKey(p, PAYLOAD_KEYS);
	if (extra !== undefined) {
		return invalid(extra, "field is not part of the payload");
	}
	if (p.v !== OUTCOME_SHARE_VERSION) {
		return invalid("v", `v must be ${OUTCOME_SHARE_VERSION}`);
	}
	if (!(OUTCOMES as readonly unknown[]).includes(p.outcome)) {
		return invalid("outcome", "outcome must be a known outcome label");
	}
	const decision = validateDecision(p.decision);
	if (!decision.ok) return decision;
	return {
		ok: true,
		value: {
			v: OUTCOME_SHARE_VERSION,
			decision: decision.value,
			outcome: p.outcome as Outcome,
		},
	};
}

/** The shareable view of one decision and the outcome linked to it. */
export function buildOutcomeSharePayload(
	decision: DecisionRecord,
	outcome: OutcomeRecord,
): Result<OutcomeSharePayload, OutcomeShareError> {
	if (outcome.decisionId !== decision.id) {
		return {
			ok: false,
			error: {
				kind: "mismatch",
				message: "outcome is linked to a different decision",
			},
		};
	}
	return validateOutcomeSharePayload({
		v: OUTCOME_SHARE_VERSION,
		decision: {
			type: decision.type,
			modelHash: decision.modelHash,
			...(isShareableAnswer(decision.type, decision.answer)
				? { answer: decision.answer }
				: {}),
			confidence: confidenceOf(decision),
			finalAction: decision.finalAction,
			latencyMs: Math.round(decision.latencyMs),
			...(decision.host === undefined ? {} : { host: decision.host }),
		},
		outcome: outcome.outcome,
	});
}

const DEFAULT_TIMEOUT_MS = 2_000;

/** The cloud's per-request caps on `POST /v1/outcomes` (maina-cloud#219). */
export const OUTCOME_SHARE_MAX_PER_REQUEST = 100;
export const OUTCOME_SHARE_MAX_BYTES = 65_536;

export type OutcomeShareCaps = Readonly<{ maxItems: number; maxBytes: number }>;

const isPositiveInteger = (n: number): boolean =>
	Number.isSafeInteger(n) && n > 0;

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;
/** `{"outcomes":[` + `]}`; each payload after the first adds one comma. */
const ENVELOPE_BYTES = byteLength(JSON.stringify({ outcomes: [] }));

/**
 * Splits `payloads`, in order, into request bodies `{ outcomes: chunk }` of
 * at most `maxItems` payloads and `maxBytes` UTF-8 bytes each. A payload too
 * large to fit a request on its own is an error, since the server would
 * refuse it whatever the batch. So are caps that are not positive whole
 * numbers, which would otherwise yield over-cap chunks.
 */
export function chunkOutcomePayloads(
	payloads: readonly OutcomeSharePayload[],
	caps: OutcomeShareCaps,
): Result<OutcomeSharePayload[][], OutcomeShareError> {
	if (!isPositiveInteger(caps.maxItems) || !isPositiveInteger(caps.maxBytes)) {
		return invalid("caps", "maxItems and maxBytes must be positive integers");
	}
	const chunks: OutcomeSharePayload[][] = [];
	let current: OutcomeSharePayload[] = [];
	let bytes = ENVELOPE_BYTES;
	for (const payload of payloads) {
		const size = byteLength(JSON.stringify(payload));
		if (ENVELOPE_BYTES + size > caps.maxBytes) {
			return invalid(
				"payload",
				`one payload is ${size} bytes; a request holds at most ${caps.maxBytes}`,
			);
		}
		// A payload after the first adds its comma separator.
		if (
			current.length > 0 &&
			(current.length >= caps.maxItems || bytes + size + 1 > caps.maxBytes)
		) {
			chunks.push(current);
			current = [];
			bytes = ENVELOPE_BYTES;
		}
		bytes += current.length === 0 ? size : size + 1;
		current.push(payload);
	}
	if (current.length > 0) chunks.push(current);
	return { ok: true, value: chunks };
}

function sendError(
	error: NetworkError,
	sent: number,
): Result<never, OutcomeShareError> {
	const status = error.kind === "http" ? error.status : undefined;
	const kind =
		status === 413
			? "payload_too_large"
			: status === 429
				? "rate_limited"
				: "network";
	return { ok: false, error: { kind, error, sent } };
}

/**
 * Shares `items` when, and only when, the effective config opts in to
 * `outcome_sharing`. Otherwise (including any consent read error) nothing
 * touches the network and the result says it was skipped.
 */
export async function shareOutcomes(
	ports: OutcomeSharePorts,
	items: ReadonlyArray<
		Readonly<{ decision: DecisionRecord; outcome: OutcomeRecord }>
	>,
	options: ShareOptions,
): Promise<Result<ShareResult, OutcomeShareError>> {
	const config = await loadCollectionConfig(ports);
	if (!config.ok || !config.value.channels.outcome_sharing.enabled) {
		return { ok: true, value: { sent: 0, skipped: "not_opted_in" } };
	}
	const payloads: OutcomeSharePayload[] = [];
	for (const item of items) {
		const payload = buildOutcomeSharePayload(item.decision, item.outcome);
		if (!payload.ok) return payload;
		payloads.push(payload.value);
	}
	const chunks = chunkOutcomePayloads(payloads, {
		maxItems: OUTCOME_SHARE_MAX_PER_REQUEST,
		maxBytes: OUTCOME_SHARE_MAX_BYTES,
	});
	if (!chunks.ok) return chunks;
	const url = `${options.baseUrl.replace(/\/+$/, "")}/v1/outcomes`;
	let sent = 0;
	// One request per chunk, in order; each counts against the server's
	// per-IP daily request limit. The server stores each batch whole or not
	// at all, so a failure stops here and `sent` counts only the acknowledged
	// chunks: they are the first `sent` items, which a caller retrying later
	// should drop to avoid duplicates. After a timeout or transport error the
	// failed chunk may still have been stored. Nothing is retried here.
	for (const chunk of chunks.value) {
		const posted = await ports.network.post({
			url,
			body: JSON.stringify({ outcomes: chunk }),
			headers: { "Content-Type": "application/json" },
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});
		if (!posted.ok) return sendError(posted.error, sent);
		sent += chunk.length;
	}
	return { ok: true, value: { sent } };
}
