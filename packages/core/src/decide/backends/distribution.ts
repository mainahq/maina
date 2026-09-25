/**
 * Distribution and state helpers shared by the built-in backends.
 *
 * How heuristic confidence is derived (FR-DEC-2):
 *
 * - **Exact rules** (keyword lists, regexes, lookups) answer with a
 *   degenerate distribution: all mass on the answer, so confidence is 1. The
 *   heuristic is its own reference until outcome capture calibrates it.
 * - **Threshold rules** (a ratio compared with a cut-off) derive the
 *   distribution from the distance to the threshold: the answer gets
 *   `0.5 + 0.5 * |value - threshold| / span`, where `span` is the room on
 *   the value's side of the threshold (`1 - threshold` above, `threshold`
 *   below). A value on the threshold is an even split; the far end of the
 *   range is certain.
 * - **Scores** are a single point-mass entry (p = 1) at the computed value.
 *
 * Confidence is always the largest probability in the distribution.
 */

import type { Result } from "../../db/index";
import type {
	Answer,
	BackendAnswer,
	BackendError,
	DecisionState,
	Question,
} from "../types";

// ── Distributions ───────────────────────────────────────────────────────────

/** All mass on `answer`, one entry per option (point mass for a score). */
export function degenerate(question: Question, answer: Answer): BackendAnswer {
	switch (question.kind) {
		case "choice":
			return {
				answer,
				distribution: question.options.map((o) => ({
					answer: o,
					p: o === answer ? 1 : 0,
				})),
			};
		case "bool":
			return boolAnswer(answer === true, 1);
		case "score":
			return { answer, distribution: [{ answer, p: 1 }] };
		default: {
			const unreachable: never = question;
			return unreachable;
		}
	}
}

/** A bool answer holding `confidence` (≥ 0.5) on `answer`. */
export function boolAnswer(answer: boolean, confidence: number): BackendAnswer {
	const other = 1 - confidence;
	return {
		answer,
		distribution: [
			{ answer: true, p: answer ? confidence : other },
			{ answer: false, p: answer ? other : confidence },
		],
	};
}

/** Confidence of a threshold rule over a value in [0, 1] (see header). */
function marginConfidence(value: number, threshold: number): number {
	const span = value >= threshold ? 1 - threshold : threshold;
	if (span <= 0) return 1;
	const margin = Math.min(1, Math.abs(value - threshold) / span);
	return 0.5 + 0.5 * margin;
}

/**
 * `whenAbove` when `value` is above `threshold` (or equal, unless `strict`),
 * its negation otherwise, with margin-derived confidence.
 */
export function thresholdAnswer(
	value: number,
	threshold: number,
	whenAbove: boolean,
	strict: boolean,
): BackendAnswer {
	const above = strict ? value > threshold : value >= threshold;
	return boolAnswer(
		above ? whenAbove : !whenAbove,
		marginConfidence(value, threshold),
	);
}

// ── Question ids ────────────────────────────────────────────────────────────

/**
 * Question ids are `<check>` or `<check>:<subject>`: the check names what is
 * asked, the subject keys the per-item state in `candidates`.
 */
export function parseQuestionId(id: string): Readonly<{
	check: string;
	subject: string;
}> {
	const colon = id.indexOf(":");
	return colon === -1
		? { check: id, subject: "" }
		: { check: id.slice(0, colon), subject: id.slice(colon + 1) };
}

// ── Answering ───────────────────────────────────────────────────────────────

export function unsupported(
	questionId: string | undefined,
	message: string,
): Result<never, BackendError> {
	return { ok: false, error: { kind: "unsupported", questionId, message } };
}

/**
 * Answers each question with `answer`, or fails on the first question it
 * returns `undefined` for.
 */
export function answerEach(
	questions: readonly Question[],
	answer: (question: Question) => BackendAnswer | undefined,
): Result<readonly BackendAnswer[], BackendError> {
	const answers: BackendAnswer[] = [];
	for (const question of questions) {
		const a = answer(question);
		if (a === undefined) {
			return unsupported(
				question.id,
				`no heuristic answers "${question.id}" with the given state`,
			);
		}
		answers.push(a);
	}
	return { ok: true, value: answers };
}

// ── State access (never throws on a malformed state) ────────────────────────

type Fields = Readonly<Record<string, unknown>>;

export function asRecord(value: unknown): Fields | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Fields)
		: undefined;
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function asStringArray(value: unknown): readonly string[] | undefined {
	return Array.isArray(value) && value.every((v) => typeof v === "string")
		? (value as readonly string[])
		: undefined;
}

/** The per-subject record `state[side].candidates[subject]`, if any. */
export function candidate(
	state: DecisionState,
	side: "trusted" | "untrusted",
	subject: string,
): Fields | undefined {
	return asRecord(asRecord(state[side].candidates)?.[subject]);
}
