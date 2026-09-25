import type { Result } from "../db/index";
import { MAX_CLARIFY_QUESTIONS } from "../features/clarify";
import type { AIContext } from "./index";
import { tryAIGenerate } from "./try-generate";

export interface SpecQuestion {
	question: string;
	type: "text" | "select";
	/** Multiple-choice answers, the recommendation first. */
	options?: string[];
	/** The answer the model recommends; always one of `options`. */
	recommended?: string;
	reason: string;
}

/**
 * Generates clarifying questions from plan.md content by asking the AI
 * to identify ambiguities, missing edge cases, and unstated assumptions.
 *
 * Returns an empty array when:
 * - Plan content is empty
 * - AI is not available (no API key)
 * - AI returns malformed JSON
 */
export async function generateSpecQuestions(
	planContent: string,
	mainaDir: string,
	ctx: AIContext,
): Promise<Result<SpecQuestion[], string>> {
	if (!planContent.trim()) {
		return { ok: true, value: [] };
	}

	const result = await tryAIGenerate(
		"spec-questions",
		mainaDir,
		{ plan: planContent },
		`Analyze this implementation plan and return 3-5 clarifying questions as a JSON array.\n\n${planContent}`,
		ctx,
	);

	if (!result.text) {
		return { ok: true, value: [] };
	}

	try {
		const parsed = parseQuestionsJSON(result.text);
		const validated = parsed.filter(isValidQuestion).map(recommendationFirst);
		return { ok: true, value: validated.slice(0, MAX_CLARIFY_QUESTIONS) };
	} catch {
		return { ok: true, value: [] };
	}
}

function parseQuestionsJSON(text: string): unknown[] {
	// Strip markdown code fences if present
	let cleaned = text.trim();
	const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch?.[1]) {
		cleaned = fenceMatch[1].trim();
	}

	const parsed: unknown = JSON.parse(cleaned);
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed;
}

/**
 * The question with its recommended option moved to the front; a
 * recommendation that is not one of the options is dropped.
 */
function recommendationFirst(q: SpecQuestion): SpecQuestion {
	const { recommended, ...rest } = q;
	const options = Array.isArray(q.options) ? q.options : undefined;
	if (
		typeof recommended !== "string" ||
		options === undefined ||
		!options.includes(recommended)
	) {
		return rest;
	}
	return {
		...rest,
		options: [recommended, ...options.filter((o) => o !== recommended)],
		recommended,
	};
}

function isValidQuestion(item: unknown): item is SpecQuestion {
	if (typeof item !== "object" || item === null) return false;
	const obj = item as Record<string, unknown>;
	return (
		typeof obj.question === "string" &&
		obj.question.length > 0 &&
		(obj.type === "text" || obj.type === "select") &&
		typeof obj.reason === "string"
	);
}
