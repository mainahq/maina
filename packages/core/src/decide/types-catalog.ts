/**
 * Every decision type in one place: what it asks, which question kinds it
 * takes, the fixed options of its choice questions and the backend that
 * serves it by default. The type list itself is `DECISION_TYPES` from the
 * policy schema (one source of truth); the default policy derives its
 * per-type backend from `defaultBackend` here.
 */

import type { ModelTier } from "../ai/tiers";
import type { Result } from "../db/index";
import type {
	FindingCategory,
	ReviewerKind,
} from "../feedback/external-reviews-types";
import {
	DECISION_TYPES,
	type DecisionBackend,
	type DecisionType,
	VERDICTS,
} from "../policy/schema";
import {
	type DecideError,
	MAX_CHOICE_OPTIONS,
	type Question,
	type QuestionKind,
} from "./types";

type CatalogEntry = Readonly<{
	type: DecisionType;
	/** The question the type answers, in one line. */
	description: string;
	/** Question kinds a request of this type may contain. */
	kinds: readonly QuestionKind[];
	/** When set, every choice option must be one of these. */
	options: readonly string[] | undefined;
	defaultBackend: DecisionBackend;
}>;

/** Options of `task.tier`, cheapest first (routing degrades down this list). */
export const MODEL_TIERS: readonly ModelTier[] = [
	"mechanical",
	"standard",
	"architectural",
];

/** Options of `review.category`. */
export const FINDING_CATEGORIES: readonly FindingCategory[] = [
	"api-mismatch",
	"signature-drift",
	"dead-code",
	"security",
	"style",
	"other",
];

/** Options of `review.reviewer_kind`. */
export const REVIEWER_KINDS: readonly ReviewerKind[] = ["bot", "human"];

type EntrySpec = Omit<CatalogEntry, "type" | "options" | "defaultBackend"> &
	Partial<Pick<CatalogEntry, "options" | "defaultBackend">>;

const SPECS: Readonly<Record<DecisionType, EntrySpec>> = {
	"action.risk": {
		description: "Is this agent action allowed, asked about or denied?",
		kinds: ["choice"],
		options: VERDICTS,
		defaultBackend: "rules",
	},
	"diff.sensitive": {
		description: "Does this diff touch security-sensitive code?",
		kinds: ["bool"],
	},
	"diff.needs_review": {
		description: "Does this diff need a deep review?",
		kinds: ["bool"],
	},
	"task.tier": {
		description: "Which model tier should run this task?",
		kinds: ["choice"],
		options: MODEL_TIERS,
	},
	"finding.real": {
		description: "Is this finding (or finding rule) a real problem?",
		kinds: ["bool"],
	},
	"finding.severity": {
		description: "How severe is this finding?",
		kinds: ["choice"],
		options: ["error", "warning", "info"],
	},
	"spec.coverage": {
		description: "Is this requirement or task covered?",
		kinds: ["bool"],
	},
	"spec.orphan": {
		description: "Does this task or change map to no requirement?",
		kinds: ["bool"],
	},
	"spec.contradiction": {
		description: "Do these two artifacts contradict each other?",
		kinds: ["bool"],
	},
	"spec.impl_leak": {
		description: "Does this line mix WHAT/WHY and HOW across spec and plan?",
		kinds: ["bool"],
	},
	"spec.quality": {
		description: "How measurable, testable, unambiguous and complete is it?",
		kinds: ["score"],
	},
	"review.category": {
		description: "Which category does this review comment belong to?",
		kinds: ["choice"],
		options: FINDING_CATEGORIES,
	},
	"review.reviewer_kind": {
		description: "Is this reviewer a bot or a human?",
		kinds: ["choice"],
		options: REVIEWER_KINDS,
	},
	slop: {
		description: "Is this code or text an AI-slop pattern?",
		kinds: ["bool"],
	},
	"wiki.relevance": {
		description: "Is this wiki article relevant to the query?",
		kinds: ["bool"],
	},
	"context.select": {
		description: "How relevant is this file to the current task?",
		kinds: ["score", "choice"],
	},
};

export const DECISION_CATALOG: Readonly<Record<DecisionType, CatalogEntry>> =
	Object.fromEntries(
		DECISION_TYPES.map((type) => {
			const spec = SPECS[type];
			const entry: CatalogEntry = {
				type,
				description: spec.description,
				kinds: spec.kinds,
				options: spec.options,
				defaultBackend: spec.defaultBackend ?? "heuristic",
			};
			return [type, entry];
		}),
	) as Record<DecisionType, CatalogEntry>;

function isDecisionType(value: string): value is DecisionType {
	return (DECISION_TYPES as readonly string[]).includes(value);
}

// ── Question validation ─────────────────────────────────────────────────────

function invalid(
	questionId: string,
	message: string,
): Result<never, DecideError> {
	return {
		ok: false,
		error: { kind: "invalid_question", questionId, message },
	};
}

function checkQuestion(
	entry: CatalogEntry,
	question: Question,
): string | undefined {
	if (!entry.kinds.includes(question.kind)) {
		return `${entry.type} takes ${entry.kinds.join(" or ")} questions, not ${question.kind}`;
	}
	switch (question.kind) {
		case "bool":
			return undefined;
		case "score":
			if (!Number.isFinite(question.min) || !Number.isFinite(question.max)) {
				return "score bounds must be finite";
			}
			return question.min < question.max
				? undefined
				: "score min must be below max";
		case "choice": {
			const { options } = question;
			if (options.length < 2 || options.length > MAX_CHOICE_OPTIONS) {
				return `choice questions take 2 to ${MAX_CHOICE_OPTIONS} options, got ${options.length}`;
			}
			if (new Set(options).size !== options.length) {
				return "choice options must be distinct";
			}
			const allowed = entry.options;
			const foreign = allowed
				? options.find((o) => !allowed.includes(o))
				: undefined;
			return foreign === undefined
				? undefined
				: `"${foreign}" is not an option of ${entry.type}`;
		}
		default: {
			const unreachable: never = question;
			return unreachable;
		}
	}
}

/**
 * Checks a request's questions against the catalog: a known type, at least
 * one question, unique non-empty ids, kinds the type takes, 2–255 distinct
 * choice options drawn from the type's fixed options, finite score bounds.
 */
export function validateQuestions(
	type: string,
	questions: readonly Question[],
): Result<DecisionType, DecideError> {
	if (!isDecisionType(type)) {
		return { ok: false, error: { kind: "unknown_type", type } };
	}
	if (questions.length === 0) return invalid("", "no questions to answer");
	const entry = DECISION_CATALOG[type];
	const seen = new Set<string>();
	for (const question of questions) {
		if (question.id.length === 0) return invalid("", "question id is empty");
		if (seen.has(question.id)) {
			return invalid(question.id, "question ids must be unique");
		}
		seen.add(question.id);
		const problem = checkQuestion(entry, question);
		if (problem !== undefined) return invalid(question.id, problem);
	}
	return { ok: true, value: type };
}
