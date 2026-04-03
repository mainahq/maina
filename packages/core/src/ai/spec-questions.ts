import type { Result } from "../db/index";
import { tryAIGenerate } from "./try-generate";

export interface SpecQuestion {
	question: string;
	type: "text" | "select";
	options?: string[];
	reason: string;
}

const MAX_QUESTIONS = 5;

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
): Promise<Result<SpecQuestion[], string>> {
	if (!planContent.trim()) {
		return { ok: true, value: [] };
	}

	const result = await tryAIGenerate(
		"spec-questions",
		mainaDir,
		{ plan: planContent },
		`Analyze this implementation plan and return 3-5 clarifying questions as a JSON array.\n\n${planContent}`,
	);

	if (!result.text) {
		return { ok: true, value: [] };
	}

	try {
		const parsed = parseQuestionsJSON(result.text);
		const validated = parsed.filter(isValidQuestion);
		return { ok: true, value: validated.slice(0, MAX_QUESTIONS) };
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
