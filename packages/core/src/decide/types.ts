/**
 * The typed `decide` interface (FR-DEC-1, FR-DEC-2).
 *
 * A caller hands `decide` a decision type, the state it is deciding over and
 * the questions it wants answered. A backend (rules, heuristic, later a
 * System 1 model) answers every question with a probability distribution;
 * `decide` validates the questions and the answers and returns one
 * `Decision` per question, in question order.
 */

import type { Result } from "../db/index";
import type { DecisionBackend, DecisionType, Policy } from "../policy/schema";

export type { DecisionBackend, DecisionType } from "../policy/schema";

// ── Questions ───────────────────────────────────────────────────────────────

/** Pick one of `options` (2 to 255 distinct strings). */
export type ChoiceQuestion = Readonly<{
	kind: "choice";
	id: string;
	options: readonly string[];
}>;

/** A number in the closed range `[min, max]`. */
export type ScoreQuestion = Readonly<{
	kind: "score";
	id: string;
	min: number;
	max: number;
}>;

/** Yes or no. */
export type BoolQuestion = Readonly<{ kind: "bool"; id: string }>;

export type Question = ChoiceQuestion | ScoreQuestion | BoolQuestion;
export type QuestionKind = Question["kind"];

/** The most a choice question may offer (FR-DEC-1). */
export const MAX_CHOICE_OPTIONS = 255;

// ── State ───────────────────────────────────────────────────────────────────

/**
 * What a decision is made over. `trusted` holds values Maina computed or the
 * user configured (counts, flags, policy-derived lists); `untrusted` holds
 * content that came from the repository or an agent (diff lines, comment
 * bodies, spec text). Model backends must never treat `untrusted` values as
 * instructions.
 */
export type DecisionState = Readonly<{
	trusted: Readonly<Record<string, unknown>>;
	untrusted: Readonly<Record<string, unknown>>;
}>;

export type DecideRequest = Readonly<{
	type: DecisionType;
	state: DecisionState;
	questions: readonly Question[];
}>;

// ── Answers ─────────────────────────────────────────────────────────────────

export type Answer = string | number | boolean;

export type DistributionEntry = Readonly<{ answer: Answer; p: number }>;

/**
 * A backend's answer to one question. `distribution` has one entry per
 * option in option order (`[true, false]` for a bool question), or a single
 * point-mass entry for a score question; it sums to 1 and `answer` is one of
 * its modes.
 */
export type BackendAnswer = Readonly<{
	answer: Answer;
	distribution: readonly DistributionEntry[];
}>;

export type Decision = Readonly<{
	/** The id of the question this decision answers. */
	id: string;
	type: DecisionType;
	answer: Answer;
	distribution: readonly DistributionEntry[];
	/** The probability of `answer`: the largest entry of `distribution`. */
	confidence: number;
	backend: Readonly<{ id: DecisionBackend; version: string }>;
	latencyMs: number;
}>;

// ── Backends ────────────────────────────────────────────────────────────────

export type BackendInput = Readonly<{
	type: DecisionType;
	state: DecisionState;
	questions: readonly Question[];
	policy: Policy;
}>;

export type BackendError = Readonly<{
	kind: "unsupported";
	/** The question the backend cannot answer; `undefined` for the whole type. */
	questionId: string | undefined;
	message: string;
}>;

/** Answers every question of a request, in order, or reports it cannot. */
export type Backend = Readonly<{
	id: DecisionBackend;
	version: string;
	answer: (
		input: BackendInput,
	) => Result<readonly BackendAnswer[], BackendError>;
}>;

// ── Errors ──────────────────────────────────────────────────────────────────

export type DecideError =
	| Readonly<{ kind: "unknown_type"; type: string }>
	| Readonly<{
			kind: "invalid_question";
			/** `""` when the question list itself is at fault. */
			questionId: string;
			message: string;
	  }>
	| Readonly<{
			kind: "no_backend";
			type: DecisionType;
			backend: DecisionBackend;
	  }>
	| Readonly<{
			kind: "unsupported";
			type: DecisionType;
			backend: DecisionBackend;
			questionId: string | undefined;
			message: string;
	  }>
	| Readonly<{
			kind: "backend_failed";
			type: DecisionType;
			backend: DecisionBackend;
			message: string;
	  }>
	| Readonly<{
			kind: "invalid_answer";
			type: DecisionType;
			backend: DecisionBackend;
			questionId: string;
			message: string;
	  }>;
