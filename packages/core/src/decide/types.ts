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

/** Tolerance for a distribution's sum, to absorb floating-point rounding. */
export const SUM_EPSILON = 1e-9;

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
 * What a model backend (System 1) reports beside an answer, for the
 * decision log and for acting on it. Numbers only: nothing here can carry
 * content from the repository. Every field is optional.
 */
export type DecisionDiagnostics = Readonly<{
	/**
	 * The calibrated distribution before any threshold, one probability per
	 * option in option order (summing to 1). A thresholded answer (an `ask`
	 * no threshold let through) is degenerate in `distribution`; this keeps
	 * what the model believed. Not for score questions.
	 */
	calibrated?: readonly number[];
	/**
	 * The probability that the answer is wrong (System 1's escalate head,
	 * converted to P(wrong)). At or over the type's cutoff, `decide`
	 * escalates: `ask` for `action.risk`, not acted for other types.
	 */
	escalate?: number;
	/** Whether the input was cut to fit the model. */
	truncated?: boolean;
	/** How many encoder windows the input took (a positive integer). */
	windows?: number;
	/** Per action class, the model's probability of it (multi-label). */
	actionClassProbs?: Readonly<Record<string, number>>;
}>;

/**
 * A backend's answer to one question. `distribution` has one entry per
 * option in option order (`[true, false]` for a bool question), or a single
 * point-mass entry for a score question; it sums to 1 and `answer` is one of
 * its modes.
 */
export type BackendAnswer = Readonly<{
	answer: Answer;
	distribution: readonly DistributionEntry[];
	diagnostics?: DecisionDiagnostics;
}>;

/**
 * What a calibrated backend (System 1) certified: the sha256 of its
 * calibration file and, per decision type, the confidence at which its
 * answer may be acted on. A `null` confidence means never act on that type.
 * `action.risk` needs none: that backend applies its own calibrated
 * thresholds before it answers.
 */
export type BackendCalibration = Readonly<{
	sha256: string;
	thresholds: Readonly<
		Partial<Record<DecisionType, Readonly<{ confidence?: number | null }>>>
	>;
}>;

/** Which backend answered, and the calibration it answered under, if any. */
export type BackendRef = Readonly<{
	id: DecisionBackend;
	version: string;
	calibration?: BackendCalibration;
}>;

export type Decision = Readonly<{
	/** The id of the question this decision answers. */
	id: string;
	type: DecisionType;
	answer: Answer;
	distribution: readonly DistributionEntry[];
	/** The probability of `answer`: the largest entry of `distribution`. */
	confidence: number;
	backend: BackendRef;
	latencyMs: number;
	/** The backend's diagnostics, validated; absent when it gave none. */
	diagnostics?: DecisionDiagnostics;
	/**
	 * Set when the backend's escalate probability reached the type's cutoff.
	 * An `action.risk` answer is then already `ask`; any other type's answer
	 * stands but is never acted on (`confidenceThreshold` is infinite).
	 */
	escalated?: true;
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
	/** Set by a calibrated backend; copied onto every `Decision` it answers. */
	calibration?: BackendCalibration;
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
