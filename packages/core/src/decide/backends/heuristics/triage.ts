/**
 * Verify triage (#329): `diff.needs_review` (does this diff warrant a deep
 * review?), `diff.sensitive` (does it touch security-sensitive code? #585)
 * and `finding.severity` (how severe is a finding, given how likely it is to
 * be real?). All are exact rules, so they answer with a degenerate
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
 * security-sensitive code: identity, access, secrets and crypto.
 */
const SECURITY_WORDS: ReadonlySet<string> = new Set([
	"auth",
	"authn",
	"authz",
	"login",
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
	"oauth",
	"oidc",
	"saml",
	"sso",
	"jwt",
	"csrf",
	"rbac",
]);

/**
 * Path words that mark business-critical code: worth a deep review, but not
 * security-sensitive by themselves.
 */
const CRITICAL_WORDS: ReadonlySet<string> = new Set([
	"session",
	"sessions",
	"payment",
	"payments",
	"billing",
	"migration",
	"migrations",
	"env",
]);

/** Splits a path segment into words: separators and camelCase humps. */
const WORD_BREAK = /[._-]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;

/** The lower-cased words of `path` (see `WORD_BREAK`). */
function pathWords(path: string): readonly string[] {
	return path
		.split("/")
		.flatMap((segment) => segment.split(WORD_BREAK))
		.map((word) => word.toLowerCase());
}

/** Whether `path` names security-sensitive code (see `SECURITY_WORDS`). */
function isSecurityPath(path: string): boolean {
	return pathWords(path).some((word) => SECURITY_WORDS.has(word));
}

/** Whether `path` names security-sensitive or business-critical code. */
function isCriticalPath(path: string): boolean {
	return pathWords(path).some(
		(word) => SECURITY_WORDS.has(word) || CRITICAL_WORDS.has(word),
	);
}

/**
 * Question `needs_review` or `needs_review:<id>`, over
 * `state.trusted = { additions, deletions, files }` and
 * `state.untrusted = { paths }`. Yes when the diff changes more than
 * `LARGE_DIFF_LINES` lines, spans more than `WIDE_DIFF_FILES` files, or
 * touches a security-sensitive or business-critical path.
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
			paths.some(isCriticalPath);
		return degenerate(q, needs);
	});
}

/**
 * Question `sensitive` or `sensitive:<id>`, over `state.untrusted.paths`
 * (the state is `triageDiff`'s: see `verify/triage.ts`). Yes when the diff
 * touches a security-sensitive path (`SECURITY_WORDS`). `untrusted.patch`
 * is for model backends; this rule reads only the paths.
 */
export function diffSensitive(
	state: DecisionState,
	questions: readonly Question[],
): Result<readonly BackendAnswer[], BackendError> {
	return answerEach(questions, (q) => {
		const { check } = parseQuestionId(q.id);
		if (q.kind !== "bool" || check !== "sensitive") return undefined;
		const paths = asStringArray(state.untrusted.paths);
		return paths === undefined
			? undefined
			: degenerate(q, paths.some(isSecurityPath));
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
