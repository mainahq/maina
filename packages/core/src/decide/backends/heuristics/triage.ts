/**
 * Verify triage (#329): `diff.needs_review` (does this diff warrant a deep
 * review?) and `finding.severity` (how severe is a finding, given how likely
 * it is to be real?). Both are exact rules, so they answer with a degenerate
 * distribution (confidence 1) until outcome capture calibrates them.
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
	asString,
	asStringArray,
	candidate,
	degenerate,
	parseQuestionId,
} from "../distribution";

/** More changed lines than this is a large diff. */
const LARGE_DIFF_LINES = 300;
/** More files than this is a wide diff. */
const WIDE_DIFF_FILES = 15;

/**
 * Path words (each directory or file name split on `.`, `-`, `_` and
 * camelCase boundaries, so `authService.ts` gives `auth`) that mark
 * security-sensitive code.
 */
const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
	"auth",
	"authn",
	"authz",
	"login",
	"session",
	"sessions",
	"security",
	"crypto",
	"secret",
	"secrets",
	"credential",
	"credentials",
	"password",
	"passwords",
	"token",
	"tokens",
	"permission",
	"permissions",
	"acl",
	"payment",
	"payments",
	"billing",
	"migration",
	"migrations",
	"env",
	"oauth",
	"oidc",
	"saml",
	"sso",
	"jwt",
	"csrf",
	"rbac",
]);

/** Splits a path segment into words: separators and camelCase humps. */
const WORD_BREAK = /[._-]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;

/** Whether `path` names security-sensitive code (see `SENSITIVE_WORDS`). */
function isSensitivePath(path: string): boolean {
	return path
		.split("/")
		.flatMap((segment) => segment.split(WORD_BREAK))
		.some((word) => SENSITIVE_WORDS.has(word.toLowerCase()));
}

/**
 * Question `needs_review` or `needs_review:<id>`, over
 * `state.trusted = { additions, deletions, files }` and
 * `state.untrusted = { paths }`. Yes when the diff changes more than
 * `LARGE_DIFF_LINES` lines, spans more than `WIDE_DIFF_FILES` files, or
 * touches a security-sensitive path.
 */
export function diffNeedsReview(
	state: DecisionState,
	questions: readonly Question[],
): Result<readonly BackendAnswer[], BackendError> {
	return answerEach(questions, (q) => {
		const { check } = parseQuestionId(q.id);
		if (q.kind !== "bool" || check !== "needs_review") return undefined;
		const additions = asNumber(state.trusted.additions);
		const deletions = asNumber(state.trusted.deletions);
		const files = asNumber(state.trusted.files);
		const paths = asStringArray(state.untrusted.paths);
		if (
			additions === undefined ||
			deletions === undefined ||
			files === undefined ||
			paths === undefined
		) {
			return undefined;
		}
		const needs =
			additions + deletions > LARGE_DIFF_LINES ||
			files > WIDE_DIFF_FILES ||
			paths.some(isSensitivePath);
		return degenerate(q, needs);
	});
}

/** Severities, most severe first; a downgrade moves one step right. */
const SEVERITIES = ["error", "warning", "info"] as const;

/**
 * Question `severity:<k>` (a choice over the severities), over
 * `state.trusted.candidates[k] = { reported, realProbability }`. The
 * reported severity, one step lower when the finding is more likely noise
 * than real (`realProbability < 0.5`). `info` stays `info`.
 */
export function findingSeverity(
	state: DecisionState,
	questions: readonly Question[],
): Result<readonly BackendAnswer[], BackendError> {
	return answerEach(questions, (q) => {
		const { check, subject } = parseQuestionId(q.id);
		if (q.kind !== "choice" || check !== "severity") return undefined;
		const facts = candidate(state, "trusted", subject);
		const reported = asString(facts?.reported);
		const p = asNumber(facts?.realProbability);
		const rank =
			reported === undefined
				? -1
				: (SEVERITIES as readonly string[]).indexOf(reported);
		if (rank === -1 || p === undefined) return undefined;
		const answer =
			p < 0.5
				? SEVERITIES[Math.min(rank + 1, SEVERITIES.length - 1)]
				: reported;
		return answer !== undefined && q.options.includes(answer)
			? degenerate(q, answer)
			: undefined;
	});
}
