/**
 * Heuristics for the single-choice decision types: `task.tier`,
 * `review.category` and `review.reviewer_kind`. All three are exact rules,
 * so every answer is a degenerate distribution.
 */

import type { Result } from "../../../db/index";
import type {
	BackendAnswer,
	BackendError,
	DecisionState,
	Question,
} from "../../types";
import { answerEach, asString, degenerate } from "../distribution";

type Heuristic = (
	state: DecisionState,
	questions: readonly Question[],
) => Result<readonly BackendAnswer[], BackendError>;

/** Answers every choice question with `pick(state)` when it is an option. */
function choiceHeuristic(
	pick: (state: DecisionState) => string | undefined,
): Heuristic {
	return (state, questions) => {
		const answer = pick(state);
		return answerEach(questions, (q) =>
			q.kind === "choice" && answer !== undefined && q.options.includes(answer)
				? degenerate(q, answer)
				: undefined,
		);
	};
}

// ── task.tier ───────────────────────────────────────────────────────────────

const MECHANICAL_TASKS = new Set([
	"commit",
	"tests",
	"slop",
	"compress",
	"code-review",
	"walkthrough",
]);
const ARCHITECTURAL_TASKS = new Set(["design-review", "architecture", "learn"]);

/**
 * state.trusted.task: the task name. `standard` for review, plan, design,
 * fix and anything unknown.
 */
export const taskTier: Heuristic = choiceHeuristic((state) => {
	const task = asString(state.trusted.task);
	if (task === undefined) return undefined;
	if (MECHANICAL_TASKS.has(task)) return "mechanical";
	if (ARCHITECTURAL_TASKS.has(task)) return "architectural";
	return "standard";
});

// ── review.category ─────────────────────────────────────────────────────────

/**
 * Keyword rules, first match wins. Deliberately cheap and deterministic so
 * ingestion needs no model call.
 */
const CATEGORY_RULES: ReadonlyArray<
	Readonly<{ category: string; patterns: readonly RegExp[] }>
> = [
	{
		category: "api-mismatch",
		patterns: [
			/doesn[''‘’]t exist/i,
			/does not exist/i,
			/won[''‘’]t typecheck/i,
			/will not typecheck/i,
			/is not exported/i,
			/no such export/i,
			/cannot find (module|name|export)/i,
			/undefined (export|symbol|identifier)/i,
			/wrong import path/i,
		],
	},
	{
		category: "signature-drift",
		patterns: [
			/wrong signature/i,
			/signature (changed|drift|mismatch)/i,
			/expected\s+`?[^`]+`?\s+(but )?got/i,
			/argument (count|type) mismatch/i,
			/parameter[s]? (changed|differ)/i,
			/return type/i,
		],
	},
	{
		category: "dead-code",
		patterns: [
			/\bunused\b/i,
			/never (called|used|read|invoked)/i,
			/dead code/i,
			/unreachable/i,
		],
	},
	{
		category: "security",
		patterns: [
			/race condition/i,
			/\brace\b/i,
			/ENOENT/,
			/spawn .* (failed|error)/i,
			/credential/i,
			/\bsecret\b/i,
			/\btoken\b.*(leak|log)/i,
			/sql injection/i,
			/command injection/i,
			/path traversal/i,
			/unsanitised|unsanitized/i,
		],
	},
	{
		category: "style",
		patterns: [
			/console\.log/i,
			/formatting/i,
			/\bnit:?\b/i,
			/style nit/i,
			/typo/i,
			/trailing whitespace/i,
			/indentation/i,
		],
	},
];

/** state.untrusted.body: the review comment. `other` when no rule matches. */
export const reviewCategory: Heuristic = choiceHeuristic((state) => {
	const body = asString(state.untrusted.body);
	if (body === undefined) return undefined;
	for (const rule of CATEGORY_RULES) {
		if (rule.patterns.some((p) => p.test(body))) return rule.category;
	}
	return "other";
});

// ── review.reviewer_kind ────────────────────────────────────────────────────

const KNOWN_BOTS = new Set<string>([
	"copilot-pull-request-reviewer",
	"copilot-pull-request-reviewer[bot]",
	"coderabbitai",
	"coderabbitai[bot]",
	"github-actions",
	"github-actions[bot]",
	"renovate",
	"renovate[bot]",
	"dependabot",
	"dependabot[bot]",
]);

/** state.untrusted.reviewer: a login. Known list, `[bot]` or `-bot` suffix. */
export const reviewerKind: Heuristic = choiceHeuristic((state) => {
	const reviewer = asString(state.untrusted.reviewer);
	if (reviewer === undefined) return undefined;
	const normalised = reviewer.toLowerCase();
	if (KNOWN_BOTS.has(normalised)) return "bot";
	if (normalised.endsWith("[bot]")) return "bot";
	if (normalised.endsWith("-bot")) return "bot";
	return "human";
});
