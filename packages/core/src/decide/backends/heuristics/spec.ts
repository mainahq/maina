/**
 * Spec and plan consistency heuristics: `spec.coverage`, `spec.orphan`,
 * `spec.contradiction`, `spec.impl_leak` and `spec.quality`.
 *
 * Call sites extract the observations (keyword counts, section counts, diff
 * files, tool pairs); these functions hold the thresholds and formulas.
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
	asBoolean,
	asNumber,
	asRecord,
	asString,
	asStringArray,
	boolAnswer,
	candidate,
	degenerate,
	parseQuestionId,
	thresholdAnswer,
} from "../distribution";

/** An exact rule's bool answer: all mass on `answer`. */
function certain(answer: boolean): BackendAnswer {
	return boolAnswer(answer, 1);
}

type Heuristic = (
	state: DecisionState,
	questions: readonly Question[],
) => Result<readonly BackendAnswer[], BackendError>;

type BoolCheck = (
	state: DecisionState,
	subject: string,
) => BackendAnswer | undefined;

/** Dispatches bool questions by the check part of their id. */
function boolChecks(checks: Readonly<Record<string, BoolCheck>>): Heuristic {
	const table = new Map(Object.entries(checks));
	return (state, questions) =>
		answerEach(questions, (q) => {
			if (q.kind !== "bool") return undefined;
			const { check, subject } = parseQuestionId(q.id);
			return table.get(check)?.(state, subject);
		});
}

/** `matched / total` from `state.trusted.candidates[k]`, when total > 0. */
function keywordRatio(state: DecisionState, k: string): number | undefined {
	const c = candidate(state, "trusted", k);
	const matched = asNumber(c?.matched);
	const total = asNumber(c?.total);
	if (matched === undefined || total === undefined || total <= 0) {
		return undefined;
	}
	return matched / total;
}

/** A file belongs to a task when it contains one of the task's keywords (3+ chars). */
function fileMatchesTask(file: string, keywords: readonly string[]): boolean {
	const fileLower = file.toLowerCase();
	return keywords.some((kw) => kw.length > 2 && fileLower.includes(kw));
}

// ── spec.coverage ───────────────────────────────────────────────────────────

/** A criterion is covered when at least half its keywords appear in the tasks. */
const CRITERION_COVERAGE = 0.5;

export const specCoverage: Heuristic = boolChecks({
	/** trusted.candidates[k] = { matched, total } keyword counts. */
	criterion: (state, k) => {
		const ratio = keywordRatio(state, k);
		return ratio === undefined
			? undefined
			: thresholdAnswer(ratio, CRITERION_COVERAGE, true, false);
	},
	/** untrusted.candidates[k].keywords of a plan task; untrusted.files changed. */
	task: (state, k) => {
		const keywords = asStringArray(candidate(state, "untrusted", k)?.keywords);
		const files = asStringArray(state.untrusted.files);
		if (keywords === undefined || files === undefined) return undefined;
		return certain(files.some((file) => fileMatchesTask(file, keywords)));
	},
});

// ── spec.orphan ─────────────────────────────────────────────────────────────

/** A task is orphaned when under a fifth of its keywords appear in the spec. */
const TASK_SPEC_OVERLAP = 0.2;

export const specOrphan: Heuristic = boolChecks({
	/** trusted.candidates[k] = { hasSpecRef, matched, total }. */
	task: (state, k) => {
		const hasSpecRef = asBoolean(candidate(state, "trusted", k)?.hasSpecRef);
		if (hasSpecRef === true) return certain(false);
		const ratio = keywordRatio(state, k);
		return hasSpecRef === undefined || ratio === undefined
			? undefined
			: thresholdAnswer(ratio, TASK_SPEC_OVERLAP, false, false);
	},
	/** untrusted.candidates[k].file changed; untrusted.taskKeywords per plan task. */
	file: (state, k) => {
		const file = asString(candidate(state, "untrusted", k)?.file);
		const tasks = state.untrusted.taskKeywords;
		if (file === undefined || !Array.isArray(tasks)) return undefined;
		const keywordLists = tasks.map(asStringArray);
		if (keywordLists.some((list) => list === undefined)) return undefined;
		const mapped = keywordLists.some(
			(list) => list !== undefined && fileMatchesTask(file, list),
		);
		return certain(!mapped);
	},
});

// ── spec.contradiction ──────────────────────────────────────────────────────

/** Two descriptions of the same task contradict under 40% keyword overlap. */
const TASK_DESCRIPTION_OVERLAP = 0.4;

export const specContradiction: Heuristic = boolChecks({
	/** trusted.candidates[k] = { matched, total } across plan.md and tasks.md. */
	task: (state, k) => {
		const ratio = keywordRatio(state, k);
		return ratio === undefined
			? undefined
			: thresholdAnswer(ratio, TASK_DESCRIPTION_OVERLAP, false, false);
	},
	/**
	 * An accepted ADR prefers one tool and the added code uses the rejected
	 * one. trusted.candidates[k] = { preferred, rejected };
	 * untrusted.candidates[k].summary; untrusted.addedText (lower-cased).
	 */
	adr: (state, k) => {
		const pair = candidate(state, "trusted", k);
		const preferred = asString(pair?.preferred);
		const rejected = asString(pair?.rejected);
		const summary = asString(candidate(state, "untrusted", k)?.summary);
		const added = asString(state.untrusted.addedText);
		if (
			preferred === undefined ||
			rejected === undefined ||
			summary === undefined ||
			added === undefined
		) {
			return undefined;
		}
		return certain(
			summary.toLowerCase().includes(preferred) && added.includes(rejected),
		);
	},
	/**
	 * A proposal uses one side of a conflicting tool pair and an ADR the other.
	 * trusted.candidates[k] = { toolA, toolB }; untrusted.candidates[k].adr
	 * (lower-cased assertions); untrusted.proposal (lower-cased).
	 */
	"adr-proposal": (state, k) => {
		const pair = candidate(state, "trusted", k);
		const toolA = asString(pair?.toolA);
		const toolB = asString(pair?.toolB);
		const adr = asString(candidate(state, "untrusted", k)?.adr);
		const proposal = asString(state.untrusted.proposal);
		if (
			toolA === undefined ||
			toolB === undefined ||
			adr === undefined ||
			proposal === undefined
		) {
			return undefined;
		}
		const conflict =
			(adr.includes(toolA) && proposal.includes(toolB)) ||
			(adr.includes(toolB) && proposal.includes(toolA));
		return certain(conflict);
	},
});

// ── spec.impl_leak ──────────────────────────────────────────────────────────

/** Implementation-detail keywords that do not belong in spec.md. */
const IMPL_KEYWORDS =
	/\b(JWT|REST|SQL|endpoint|database|schema|implementation|deploy)\b/i;

/** User-story language that does not belong in plan.md. */
const STORY_PATTERN = /\bAs a (user|developer|admin|customer)\b/i;

function lineMatches(pattern: RegExp): BoolCheck {
	return (state, k) => {
		const text = asString(candidate(state, "untrusted", k)?.text);
		return text === undefined ? undefined : certain(pattern.test(text));
	};
}

export const specImplLeak: Heuristic = boolChecks({
	"impl-in-spec": lineMatches(IMPL_KEYWORDS),
	"story-in-plan": lineMatches(STORY_PATTERN),
});

// ── spec.quality ────────────────────────────────────────────────────────────

/** Each weasel word costs this many ambiguity points. */
const WEASEL_PENALTY = 10;
/** Each [NEEDS CLARIFICATION] marker costs this many completeness points. */
const CLARIFICATION_PENALTY = 10;

function percent(part: number, whole: number): number {
	return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/**
 * Scores 0–100 per dimension from the counts in state.trusted: `criteria`,
 * `measurable`, `testable`, `weaselWords`, `sectionsPresent`,
 * `sectionsRequired`, `clarificationMarkers`. `overall` is the equal-weight
 * average of the four dimensions.
 */
function qualityScores(
	trusted: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, number> | undefined {
	const counts = asRecord(trusted);
	const read = (key: string) => asNumber(counts?.[key]);
	const criteria = read("criteria");
	const measurable = read("measurable");
	const testable = read("testable");
	const weasel = read("weaselWords");
	const present = read("sectionsPresent");
	const required = read("sectionsRequired");
	const markers = read("clarificationMarkers");
	if (
		criteria === undefined ||
		measurable === undefined ||
		testable === undefined ||
		weasel === undefined ||
		present === undefined ||
		required === undefined ||
		markers === undefined
	) {
		return undefined;
	}
	const measurability = percent(measurable, criteria);
	const testability = percent(testable, criteria);
	const ambiguity = Math.max(0, 100 - weasel * WEASEL_PENALTY);
	const completeness = Math.max(
		0,
		percent(present, required) - markers * CLARIFICATION_PENALTY,
	);
	const overall = Math.round(
		measurability * 0.25 +
			testability * 0.25 +
			ambiguity * 0.25 +
			completeness * 0.25,
	);
	return new Map(
		Object.entries({
			measurability,
			testability,
			ambiguity,
			completeness,
			overall,
		}),
	);
}

export const specQuality: Heuristic = (state, questions) => {
	const scores = qualityScores(state.trusted);
	return answerEach(questions, (q) => {
		const score = scores?.get(q.id);
		if (q.kind !== "score" || score === undefined) return undefined;
		return score < q.min || score > q.max ? undefined : degenerate(q, score);
	});
};
