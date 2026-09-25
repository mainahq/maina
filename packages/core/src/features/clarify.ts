/**
 * Spec clarification (FR-SPEC-1): turns a spec's `[NEEDS CLARIFICATION]`
 * markers, plus any suggested questions, into a short interview.
 *
 * - At most `MAX_CLARIFY_MARKERS` markers are asked about, in document
 *   order; the rest are reported as overflow so the caller can ask the
 *   writer to turn them into assumptions.
 * - At most `MAX_CLARIFY_QUESTIONS` questions in total, asked one at a time:
 *   only the current question can be answered.
 * - Questions are multiple choice with the recommendation first; a question
 *   with no options takes a short answer.
 * - Each answer is written back into the spec: the marker it resolves is
 *   replaced by the answer and the exchange is logged under
 *   `## Clarifications`.
 *
 * Pure: a session is data, and every step returns a new one.
 */

import type { Result } from "../db/index";

export const MAX_CLARIFY_MARKERS = 3;
export const MAX_CLARIFY_QUESTIONS = 5;

/** Most options a marker's inline alternatives may yield. */
const MAX_MARKER_OPTIONS = 5;
/** Longest inline alternative, in words, that still reads as an option. */
const MAX_OPTION_WORDS = 6;

export type ClarifyQuestion = Readonly<{
	/** `Q1` … `Q5`, in asking order. */
	id: string;
	question: string;
	/** The recommendation first; empty for a short-answer question. */
	options: readonly string[];
	recommended: string | undefined;
	/** The exact marker text this question resolves, for marker questions. */
	marker: string | undefined;
}>;

/** A question proposed from outside the spec, e.g. by `generateSpecQuestions`. */
export type ClarifySuggestion = Readonly<{
	question: string;
	options?: readonly string[];
	recommended?: string;
}>;

export type ClarifyAnswer = Readonly<{ id: string; answer: string }>;

export type ClarifySession = Readonly<{
	spec: string;
	questions: readonly ClarifyQuestion[];
	answered: readonly ClarifyAnswer[];
	/** Markers past the cap, in document order; they are not asked about. */
	overflowMarkers: readonly string[];
}>;

export type ClarifyError = Readonly<{
	kind: "not_current" | "empty_answer" | "done";
	message: string;
}>;

type Marker = Readonly<{ text: string; body: string; context: string }>;

const MARKER = /\[NEEDS CLARIFICATION(?::\s*([^\]]*))?\]/g;

/** `line` with inline code spans blanked, so quoted markers are skipped. */
function maskInlineCode(line: string): string {
	return line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
}

function findMarkers(spec: string): Marker[] {
	const markers: Marker[] = [];
	for (const line of spec.split("\n")) {
		const masked = maskInlineCode(line);
		for (const match of masked.matchAll(MARKER)) {
			const start = match.index ?? 0;
			const text = line.slice(start, start + match[0].length);
			const context = line
				.slice(0, start)
				.replace(/^\s*[-*]\s*(\[.\]\s*)?/, "")
				.replaceAll("**", "")
				.trim();
			const rest = line
				.slice(start + match[0].length)
				.replaceAll("**", "")
				.trim();
			markers.push({
				text,
				body: (match[1] ?? "").trim() || rest,
				context,
			});
		}
	}
	return markers;
}

/**
 * Every `[NEEDS CLARIFICATION]` / `[NEEDS CLARIFICATION: …]` marker in
 * `spec`, in document order; markers quoted in inline code are skipped.
 */
export function findClarificationMarkers(spec: string): readonly string[] {
	return findMarkers(spec).map((m) => m.text);
}

/**
 * The alternatives a marker lists (`SSO, email+password, or device code?`),
 * or `[]` when its body is not a short list of choices.
 */
function markerOptions(body: string): string[] {
	if (!body.endsWith("?")) return [];
	const parts = body
		.slice(0, -1)
		.split(/\s*,\s*(?:or\s+)?|\s+or\s+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	const short = parts.every((p) => p.split(/\s+/).length <= MAX_OPTION_WORDS);
	return parts.length >= 2 && parts.length <= MAX_MARKER_OPTIONS && short
		? parts
		: [];
}

/** `options` with `recommended` moved (or added) to the front. */
function recommendationFirst(
	options: readonly string[],
	recommended: string | undefined,
): readonly string[] {
	if (recommended === undefined) return options;
	return [recommended, ...options.filter((o) => o !== recommended)];
}

function markerQuestion(marker: Marker, index: number): ClarifyQuestion {
	const options = markerOptions(marker.body);
	const question =
		marker.context.length > 0
			? `${marker.context.replace(/[:\s]+$/, "")}: ${marker.body}`
			: marker.body || "Resolve this open item";
	return {
		id: `Q${index + 1}`,
		question,
		options,
		recommended: options[0],
		marker: marker.text,
	};
}

function suggestionQuestion(
	suggestion: ClarifySuggestion,
	index: number,
): ClarifyQuestion {
	const given = suggestion.options ?? [];
	const recommended = suggestion.recommended ?? given[0];
	return {
		id: `Q${index + 1}`,
		question: suggestion.question,
		// Without options the question takes a short answer; a lone
		// recommendation is kept as the suggested default, not a choice.
		options: given.length > 0 ? recommendationFirst(given, recommended) : [],
		recommended,
		marker: undefined,
	};
}

/**
 * Starts a clarification session over `spec`: marker questions first (at
 * most three, in document order), then `suggestions`, capped at five.
 */
export function clarify(
	spec: string,
	suggestions: readonly ClarifySuggestion[] = [],
): ClarifySession {
	const markers = findMarkers(spec);
	const asked = markers.slice(0, MAX_CLARIFY_MARKERS);
	const fromMarkers = asked.map(markerQuestion);
	const room = MAX_CLARIFY_QUESTIONS - fromMarkers.length;
	const fromSuggestions = suggestions
		.filter((s) => s.question.trim().length > 0)
		.slice(0, room)
		.map((s, i) => suggestionQuestion(s, fromMarkers.length + i));
	return {
		spec,
		questions: [...fromMarkers, ...fromSuggestions],
		answered: [],
		overflowMarkers: markers.slice(MAX_CLARIFY_MARKERS).map((m) => m.text),
	};
}

/** The one question to ask now, or `undefined` when all are answered. */
export function nextQuestion(
	session: ClarifySession,
): ClarifyQuestion | undefined {
	return session.questions[session.answered.length];
}

const CLARIFICATIONS_HEADING = "## Clarifications";

/** `spec` with `entry` appended to its Clarifications section. */
function logClarification(spec: string, entry: string): string {
	const lines = spec.split("\n");
	const at = lines.findIndex((l) => l.trim() === CLARIFICATIONS_HEADING);
	if (at === -1) {
		return `${spec.trimEnd()}\n\n${CLARIFICATIONS_HEADING}\n\n${entry}\n`;
	}
	const next = lines.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l));
	const end = next === -1 ? lines.length : next;
	// The section up to its last non-blank line, then the new entry.
	const head = lines.slice(0, end);
	while (head.length > at + 1 && (head.at(-1) ?? "").trim() === "") {
		head.pop();
	}
	if (head.length === at + 1) head.push("");
	head.push(entry);
	const tail = lines.slice(end);
	return tail.length === 0
		? `${head.join("\n")}\n`
		: `${head.join("\n")}\n\n${tail.join("\n")}`;
}

/**
 * Answers the current question: the answer (collapsed to one line) replaces
 * the marker the question resolves and is logged under `## Clarifications`.
 * Only the current question can be answered.
 */
export function answerQuestion(
	session: ClarifySession,
	id: string,
	answer: string,
): Result<ClarifySession, ClarifyError> {
	const current = nextQuestion(session);
	if (current === undefined) {
		return {
			ok: false,
			error: { kind: "done", message: "every question is answered" },
		};
	}
	if (current.id !== id) {
		return {
			ok: false,
			error: {
				kind: "not_current",
				message: `${id} is not the current question; answer ${current.id} first`,
			},
		};
	}
	const text = answer.replace(/\s+/g, " ").trim();
	if (text.length === 0) {
		return {
			ok: false,
			error: { kind: "empty_answer", message: "the answer is empty" },
		};
	}
	const resolved =
		current.marker === undefined
			? session.spec
			: session.spec.replace(current.marker, () => text);
	const spec = logClarification(
		resolved,
		`- Q: ${current.question} → A: ${text}`,
	);
	return {
		ok: true,
		value: {
			...session,
			spec,
			answered: [...session.answered, { id, answer: text }],
		},
	};
}
