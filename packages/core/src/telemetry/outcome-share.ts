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
	| Readonly<{ kind: "network"; error: NetworkError }>;

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
	if (payloads.length === 0) return { ok: true, value: { sent: 0 } };
	const posted = await ports.network.post({
		url: `${options.baseUrl.replace(/\/+$/, "")}/v1/outcomes`,
		body: JSON.stringify({ outcomes: payloads }),
		headers: { "Content-Type": "application/json" },
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	});
	return posted.ok
		? { ok: true, value: { sent: payloads.length } }
		: { ok: false, error: { kind: "network", error: posted.error } };
}
