/**
 * `decide` (FR-DEC-1, FR-DEC-2): the single entry point for every heuristic
 * or learned judgement in core. Pure given its ports: the only effect is
 * reading `ports.clock` to measure latency, and the result depends only on
 * the ports and the request.
 */

import type { Result } from "../db/index";
import { DEFAULT_POLICY } from "../policy/defaults";
import type { Policy } from "../policy/schema";
import type { ClockPort } from "../ports/clock";
import {
	type BackendRegistry,
	DEFAULT_REGISTRY,
	selectBackend,
} from "./registry";
import type {
	Backend,
	BackendAnswer,
	DecideError,
	DecideRequest,
	Decision,
	DecisionType,
	Question,
} from "./types";
import { validateQuestions } from "./types-catalog";

export type DecidePorts = Readonly<{
	clock: ClockPort;
	/** Picks the backend per decision type. */
	policy: Policy;
	backends: BackendRegistry;
}>;

/**
 * Ports for 1.x call sites that do not receive ports yet: the built-in
 * policy and backends, and the wall clock for latency. Callers that have
 * `CorePorts` and a loaded policy should build their own.
 */
export const defaultDecidePorts: DecidePorts = {
	clock: { now: () => Date.now() },
	policy: DEFAULT_POLICY,
	backends: DEFAULT_REGISTRY,
};

/** Tolerance for a distribution's sum, to absorb floating-point rounding. */
const SUM_EPSILON = 1e-9;

function expectedOptions(question: Question): readonly unknown[] | undefined {
	switch (question.kind) {
		case "choice":
			return question.options;
		case "bool":
			return [true, false];
		case "score":
			return undefined;
		default: {
			const unreachable: never = question;
			return unreachable;
		}
	}
}

/** Why `answer` is not a valid answer to `question`, or `undefined`. */
function answerProblem(
	question: Question,
	answer: BackendAnswer | undefined,
): string | undefined {
	// Backends (a model, later) can hand back anything: check the shape
	// before reading it, so a malformed answer is an error, never a throw.
	if (typeof answer !== "object" || answer === null) {
		return "answer is missing";
	}
	const { distribution } = answer;
	if (
		!Array.isArray(distribution) ||
		distribution.some((e) => typeof e !== "object" || e === null)
	) {
		return "distribution must be a list of { answer, p } entries";
	}
	if (distribution.some((e) => !Number.isFinite(e.p) || e.p < 0 || e.p > 1)) {
		return "every probability must be within [0, 1]";
	}
	const total = distribution.reduce((sum, e) => sum + e.p, 0);
	if (Math.abs(total - 1) > SUM_EPSILON) {
		return `distribution sums to ${total}, not 1`;
	}
	const options = expectedOptions(question);
	if (options === undefined) {
		if (question.kind !== "score") return "unexpected question kind";
		const value = answer.answer;
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			value < question.min ||
			value > question.max
		) {
			return `score must be a number within [${question.min}, ${question.max}]`;
		}
		const [only] = distribution;
		return distribution.length === 1 && only?.answer === value
			? undefined
			: "a score distribution is a single entry at the answer";
	}
	if (
		distribution.length !== options.length ||
		distribution.some((e, i) => e.answer !== options[i])
	) {
		return "distribution needs one entry per option, in option order";
	}
	const chosen = distribution.find((e) => e.answer === answer.answer);
	if (chosen === undefined) return "answer is not one of the options";
	const max = Math.max(...distribution.map((e) => e.p));
	return chosen.p === max
		? undefined
		: "answer is not a mode of its distribution";
}

function backendFailed(
	backend: Backend,
	type: DecisionType,
	message: string,
): Result<never, DecideError> {
	return {
		ok: false,
		error: { kind: "backend_failed", type, backend: backend.id, message },
	};
}

function callBackend(
	backend: Backend,
	type: DecisionType,
	request: DecideRequest,
	policy: Policy,
): Result<readonly BackendAnswer[], DecideError> {
	let result: ReturnType<Backend["answer"]>;
	try {
		result = backend.answer({
			type,
			state: request.state,
			questions: request.questions,
			policy,
		});
	} catch (e) {
		return backendFailed(
			backend,
			type,
			e instanceof Error ? e.message : String(e),
		);
	}
	if (typeof result !== "object" || result === null) {
		return backendFailed(backend, type, "backend returned no result");
	}
	if (!result.ok) {
		return {
			ok: false,
			error: { ...result.error, type, backend: backend.id },
		};
	}
	if (!Array.isArray(result.value)) {
		return backendFailed(backend, type, "backend returned no answer list");
	}
	return { ok: true, value: result.value };
}

/**
 * Answers every question of `request` with the backend the policy selects
 * and returns one `Decision` per question, in question order. Invalid
 * questions are rejected before any backend runs; a backend answer that is
 * not a valid distribution over the question's options is an error, never a
 * decision.
 */
export function decide(
	ports: DecidePorts,
	request: DecideRequest,
): Result<readonly Decision[], DecideError> {
	const started = ports.clock.now();
	const valid = validateQuestions(request.type, request.questions);
	if (!valid.ok) return valid;
	const type = valid.value;

	const selected = selectBackend(ports.backends, ports.policy, type);
	if (!selected.ok) return selected;
	const backend = selected.value;

	const answered = callBackend(backend, type, request, ports.policy);
	if (!answered.ok) return answered;
	const answers = answered.value;

	const invalidAnswer = (questionId: string, message: string) =>
		({
			ok: false,
			error: {
				kind: "invalid_answer",
				type,
				backend: backend.id,
				questionId,
				message,
			},
		}) as const;
	if (answers.length !== request.questions.length) {
		return invalidAnswer(
			"",
			`expected ${request.questions.length} answers, got ${answers.length}`,
		);
	}

	const latencyMs = Math.max(0, ports.clock.now() - started);
	const decisions: Decision[] = [];
	for (const [i, question] of request.questions.entries()) {
		const answer: BackendAnswer | undefined = answers[i];
		const problem = answerProblem(question, answer);
		if (problem !== undefined || answer === undefined) {
			return invalidAnswer(question.id, problem ?? "answer is missing");
		}
		decisions.push({
			id: question.id,
			type,
			answer: answer.answer,
			distribution: answer.distribution,
			confidence: Math.max(...answer.distribution.map((e) => e.p)),
			backend: { id: backend.id, version: backend.version },
			latencyMs,
		});
	}
	return { ok: true, value: decisions };
}

// ── Helpers for call sites ──────────────────────────────────────────────────

/**
 * The answers of a bool request, in question order, or `fallback` for every
 * question when `decide` fails. For 1.x sites whose signature cannot carry
 * an error yet.
 */
export function boolAnswers(
	result: Result<readonly Decision[], DecideError>,
	count: number,
	fallback: boolean,
): readonly boolean[] {
	return result.ok
		? result.value.map((d) => d.answer === true)
		: Array.from({ length: count }, () => fallback);
}

/** Like `boolAnswers`, for score questions. */
export function scoreAnswers(
	result: Result<readonly Decision[], DecideError>,
	count: number,
	fallback: number,
): readonly number[] {
	return result.ok
		? result.value.map((d) =>
				typeof d.answer === "number" ? d.answer : fallback,
			)
		: Array.from({ length: count }, () => fallback);
}

type Fields = Readonly<Record<string, unknown>>;

/**
 * Asks one bool question per candidate, `<check>:<i>`, with candidate `i`'s
 * observations at `state.trusted.candidates[i]` / `state.untrusted.candidates[i]`
 * and `shared` fields beside `candidates`. Returns the answers in candidate
 * order, `[]` when there are no candidates, or `fallback` for every
 * candidate when `decide` fails.
 */
export function decideEach(
	ports: DecidePorts,
	request: Readonly<{
		type: DecisionType;
		check: string;
		trusted?: readonly Fields[];
		untrusted?: readonly Fields[];
		shared?: Readonly<{ trusted?: Fields; untrusted?: Fields }>;
		fallback?: boolean;
	}>,
): readonly boolean[] {
	const count = Math.max(
		request.trusted?.length ?? 0,
		request.untrusted?.length ?? 0,
	);
	if (count === 0) return [];
	const side = (shared: Fields | undefined, items: readonly Fields[] = []) => ({
		...shared,
		candidates: Object.fromEntries(items.map((item, i) => [i, item])),
	});
	const result = decide(ports, {
		type: request.type,
		state: {
			trusted: side(request.shared?.trusted, request.trusted),
			untrusted: side(request.shared?.untrusted, request.untrusted),
		},
		questions: Array.from({ length: count }, (_, i) => ({
			kind: "bool",
			id: `${request.check}:${i}`,
		})),
	});
	return boolAnswers(result, count, request.fallback ?? false);
}

/** The answer to a single choice question, or `fallback` when `decide` fails. */
export function choiceAnswer<T extends string>(
	result: Result<readonly Decision[], DecideError>,
	options: readonly T[],
	fallback: T,
): T {
	if (!result.ok) return fallback;
	const answer = result.value[0]?.answer;
	return options.find((o) => o === answer) ?? fallback;
}
