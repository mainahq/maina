import type { Result } from "../db/index";
import { tryAIGenerate } from "./try-generate";

export interface DesignApproach {
	name: string;
	description: string;
	pros: string[];
	cons: string[];
	recommended: boolean;
}

const MAX_APPROACHES = 3;

/**
 * Generates 2-3 design approaches with pros/cons/recommendation by asking
 * the AI to analyze the design context and propose alternatives.
 *
 * Returns an empty array when:
 * - Context is empty
 * - AI is not available (no API key)
 * - AI returns malformed JSON
 */
export async function generateDesignApproaches(
	designContext: string,
	mainaDir: string,
): Promise<Result<DesignApproach[], string>> {
	if (!designContext.trim()) {
		return { ok: true, value: [] };
	}

	const result = await tryAIGenerate(
		"design-approaches",
		mainaDir,
		{ context: designContext },
		`Propose 2-3 architectural approaches for this design decision as a JSON array.\n\n${designContext}`,
	);

	if (!result.text) {
		return { ok: true, value: [] };
	}

	try {
		const parsed = parseApproachesJSON(result.text);
		const validated = parsed.filter(isValidApproach);
		return { ok: true, value: validated.slice(0, MAX_APPROACHES) };
	} catch {
		return { ok: true, value: [] };
	}
}

function parseApproachesJSON(text: string): unknown[] {
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

function isValidApproach(item: unknown): item is DesignApproach {
	if (typeof item !== "object" || item === null) return false;
	const obj = item as Record<string, unknown>;
	return (
		typeof obj.name === "string" &&
		obj.name.length > 0 &&
		typeof obj.description === "string" &&
		Array.isArray(obj.pros) &&
		Array.isArray(obj.cons) &&
		typeof obj.recommended === "boolean"
	);
}
