/**
 * Validates AI-generated output for slop patterns before presenting to users.
 *
 * Catches: hallucinated imports, console.log suggestions, empty function bodies,
 * bare TODOs without tickets, and other common AI slop in generated text.
 * Whether each pattern is present is a `slop` decision; the warnings are
 * reported in this order.
 */

import { boolAnswers, decide, defaultDecidePorts } from "../decide/decide";

export interface AIValidationResult {
	clean: boolean;
	warnings: string[];
	sanitized: string;
}

/** `slop` question id → the warning shown when the answer is yes. */
const SLOP_CHECKS: ReadonlyArray<readonly [id: string, message: string]> = [
	["ai-console", "AI suggested console.log — stripped"],
	["ai-todo", "AI generated TODO without ticket reference"],
	["ai-placeholder-import", "AI hallucinated a placeholder import"],
	["ai-empty-function", "AI generated empty function body"],
	["ai-any", "AI used 'any' type — violates strict mode"],
];

/**
 * Check AI-generated text for slop patterns.
 * Returns warnings and optionally sanitized output.
 */
export function validateAIOutput(text: string): AIValidationResult {
	const result = decide(defaultDecidePorts, {
		type: "slop",
		state: { trusted: {}, untrusted: { text } },
		questions: SLOP_CHECKS.map(([id]) => ({ kind: "bool", id })),
	});
	const flagged = boolAnswers(result, SLOP_CHECKS.length, false);
	const warnings = SLOP_CHECKS.filter((_, i) => flagged[i]).map(
		([, message]) => message,
	);

	// Sanitize: remove console.log lines from code suggestions
	const sanitized = text.replace(
		/^\s*console\.(log|warn|error|debug|info)\(.*\);?\s*$/gm,
		"",
	);

	return {
		clean: warnings.length === 0,
		warnings,
		sanitized: sanitized.trim(),
	};
}
