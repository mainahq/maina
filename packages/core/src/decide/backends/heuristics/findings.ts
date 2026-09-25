/**
 * `finding.real`: is a finding rule worth keeping, judged from how often
 * users dismissed it.
 */

import type { Result } from "../../../db/index";
import type {
	BackendAnswer,
	BackendError,
	DecisionState,
	Question,
} from "../../types";
import {
	answerEach,
	asNumber,
	boolAnswer,
	candidate,
	parseQuestionId,
	thresholdAnswer,
} from "../distribution";

/** A rule needs this many recorded outcomes before it can be called noise. */
const MIN_RULE_SAMPLES = 5;
/** Above this dismissal rate a rule is noise. */
const NOISY_RATE = 0.5;

/**
 * Question `rule:<k>`, state.trusted.candidates[k] =
 * `{ falsePositiveRate, totalCount }`. A rule is not real (noise) when more
 * than half its findings were dismissed over at least 5 samples. With fewer
 * samples it is kept at an even split: there is no evidence either way.
 */
export function findingReal(
	state: DecisionState,
	questions: readonly Question[],
): Result<readonly BackendAnswer[], BackendError> {
	return answerEach(questions, (q) => {
		const { check, subject } = parseQuestionId(q.id);
		const rule = candidate(state, "trusted", subject);
		const rate = asNumber(rule?.falsePositiveRate);
		const total = asNumber(rule?.totalCount);
		if (q.kind !== "bool" || check !== "rule") return undefined;
		if (rate === undefined || total === undefined) return undefined;
		if (total < MIN_RULE_SAMPLES) return boolAnswer(true, 0.5);
		return thresholdAnswer(rate, NOISY_RATE, false, true);
	});
}
