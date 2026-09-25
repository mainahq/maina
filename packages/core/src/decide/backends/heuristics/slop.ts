/**
 * `slop`: is this code or text an AI-slop pattern? Three families of checks,
 * all exact rules (degenerate distributions):
 *
 * - `ai-*` over `state.untrusted.text`: generated text before it is shown.
 * - `diff-*:<k>` over `state.untrusted.candidates[k].text`: one added diff line.
 * - `<rule>:<k>` over a source candidate the slop scanner found; the scanner
 *   observes (line text, whether the import resolved, block length), the
 *   heuristic judges.
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
	asString,
	candidate,
	degenerate,
	parseQuestionId,
} from "../distribution";

// ── Generated text (ai/validate) ────────────────────────────────────────────

const AI_TEXT_PATTERNS: ReadonlyMap<string, RegExp> = new Map(
	Object.entries({
		"ai-console": /console\.(log|warn|error|debug|info)\s*\(/,
		"ai-todo": /\/\/\s*(?:TO)(?:DO)(?!\s*[(#[])/,
		"ai-placeholder-import":
			/import\s+.*from\s+['"]\.\/(?:nonexistent|placeholder|example)['"]/,
		"ai-empty-function": /function\s+\w+\s*\([^)]*\)\s*\{\s*\}/,
		"ai-any": /(?:as any|: any\b)/,
	}),
);

// ── Added diff lines (review code quality) ──────────────────────────────────

/** Longest added line that is not flagged. */
const MAX_LINE_LENGTH = 120;

const DIFF_LINE_CHECKS: ReadonlyMap<string, (text: string) => boolean> =
	new Map(
		Object.entries({
			"diff-console-log": (text: string) => /console\.log\s*\(/.test(text),
			// Case-sensitive so identifiers like handleCreateTodo are skipped. Allows
			// TODO(#123) and TODO(JIRA-456).
			"diff-todo": (text: string) =>
				/\bTODO\b/.test(text) &&
				!/TODO\s*[(#]|TODO\s*\([A-Z]+-\d+\)/.test(text),
			"diff-empty-body": (text: string) =>
				/(?:function\s+\w+\s*\([^)]*\)|=>\s*)\s*\{\s*\}/.test(text) ||
				/\)\s*\{\s*\}/.test(text),
			"diff-long-line": (text: string) => text.length > MAX_LINE_LENGTH,
		}),
	);

// ── Source candidates (verify/slop) ─────────────────────────────────────────

/** A ticket reference: #123, PROJ-123, [#123], (PROJ-123). */
const TICKET_PATTERN = /#\d+|\b[A-Z][A-Z0-9]+-\d+/;

/** Consecutive commented-out code lines that make a finding. */
const MIN_COMMENTED_BLOCK = 3;

/**
 * Whether a trimmed line holding empty braces (or ending in `{` with `}` on
 * the next line) is an empty function, method or arrow body rather than an
 * object literal, type, string or regex.
 */
function isEmptyFunctionBody(trimmed: string, next: string): boolean {
	if (
		/(?:const|let|var|type|interface|enum)\s+\w+.*=\s*\{/.test(trimmed) &&
		!trimmed.includes("=>")
	) {
		return false;
	}
	if (/\{\s*\}/.test(trimmed)) {
		if (
			/\/.*\{\\s\*\}.*\//.test(trimmed) ||
			/['"`].*\{\s*\}.*['"`]/.test(trimmed)
		) {
			return false;
		}
		const fnDeclPattern = /function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*\}/;
		const arrowPattern = /=>\s*\{\s*\}/;
		const methodPattern =
			/^\s*(?:(?:public|private|protected|static|async|get|set|override)\s+)*\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*\}/;
		const nonFnPattern =
			/(?:const|let|var|type|interface|enum|import|export\s+(?:type|interface))\s/;
		return (
			fnDeclPattern.test(trimmed) ||
			arrowPattern.test(trimmed) ||
			(methodPattern.test(trimmed) && !nonFnPattern.test(trimmed))
		);
	}
	if (trimmed.endsWith("{") && next === "}") {
		return (
			/function\s+\w+\s*\(/.test(trimmed) ||
			/=>\s*\{$/.test(trimmed) ||
			(/^\s*(?:(?:public|private|protected|static|async|get|set|override)\s+)*\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\{$/.test(
				trimmed,
			) &&
				!/(?:const|let|var|type|interface|enum|import|class|if|else|for|while|switch|try|catch)\s/.test(
					trimmed,
				))
		);
	}
	return false;
}

type SourceCheck = (
	state: DecisionState,
	subject: string,
) => boolean | undefined;

const SOURCE_CHECKS: ReadonlyMap<string, SourceCheck> = new Map(
	Object.entries({
		"console-log": (state, k) => {
			const ignored = asBoolean(candidate(state, "trusted", k)?.lintIgnored);
			return ignored === undefined ? undefined : !ignored;
		},
		"todo-without-ticket": (state, k) => {
			const text = asString(candidate(state, "untrusted", k)?.text);
			return text === undefined ? undefined : !TICKET_PATTERN.test(text);
		},
		"empty-body": (state, k) => {
			const c = candidate(state, "untrusted", k);
			const text = asString(c?.text);
			const next = asString(c?.next);
			return text === undefined || next === undefined
				? undefined
				: isEmptyFunctionBody(text, next);
		},
		"hallucinated-import": (state, k) => {
			const resolved = asBoolean(candidate(state, "trusted", k)?.resolved);
			return resolved === undefined ? undefined : !resolved;
		},
		"commented-code": (state, k) => {
			const lines = asNumber(candidate(state, "trusted", k)?.blockLines);
			return lines === undefined ? undefined : lines >= MIN_COMMENTED_BLOCK;
		},
	} satisfies Record<string, SourceCheck>),
);

function answerSlop(
	state: DecisionState,
	question: Question,
): boolean | undefined {
	const { check, subject } = parseQuestionId(question.id);
	const textPattern = AI_TEXT_PATTERNS.get(check);
	if (textPattern !== undefined) {
		const text = asString(state.untrusted.text);
		return text === undefined ? undefined : textPattern.test(text);
	}
	const lineCheck = DIFF_LINE_CHECKS.get(check);
	if (lineCheck !== undefined) {
		const text = asString(candidate(state, "untrusted", subject)?.text);
		return text === undefined ? undefined : lineCheck(text);
	}
	return SOURCE_CHECKS.get(check)?.(state, subject);
}

export function slop(
	state: DecisionState,
	questions: readonly Question[],
): Result<readonly BackendAnswer[], BackendError> {
	return answerEach(questions, (q) => {
		if (q.kind !== "bool") return undefined;
		const answer = answerSlop(state, q);
		return answer === undefined ? undefined : degenerate(q, answer);
	});
}
