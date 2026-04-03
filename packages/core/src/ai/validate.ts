/**
 * Validates AI-generated output for slop patterns before presenting to users.
 *
 * Catches: hallucinated imports, console.log suggestions, empty function bodies,
 * TODO without tickets, and other common AI slop in generated text.
 */

export interface AIValidationResult {
	clean: boolean;
	warnings: string[];
	sanitized: string;
}

const SLOP_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
	{
		pattern: /console\.(log|warn|error|debug|info)\s*\(/g,
		message: "AI suggested console.log — stripped",
	},
	{
		pattern: /\/\/\s*TODO(?!\s*[(#[])/gi,
		message: "AI generated TODO without ticket reference",
	},
	{
		pattern:
			/import\s+.*from\s+['"]\.\/(?:nonexistent|placeholder|example)['"]/g,
		message: "AI hallucinated a placeholder import",
	},
	{
		pattern: /function\s+\w+\s*\([^)]*\)\s*\{\s*\}/g,
		message: "AI generated empty function body",
	},
	{
		pattern: /(?:as any|: any\b)/g,
		message: "AI used 'any' type — violates strict mode",
	},
];

/**
 * Check AI-generated text for slop patterns.
 * Returns warnings and optionally sanitized output.
 */
export function validateAIOutput(text: string): AIValidationResult {
	const warnings: string[] = [];
	let sanitized = text;

	for (const { pattern, message } of SLOP_PATTERNS) {
		// Reset lastIndex for global patterns
		pattern.lastIndex = 0;
		if (pattern.test(text)) {
			warnings.push(message);
		}
		pattern.lastIndex = 0;
	}

	// Sanitize: remove console.log lines from code suggestions
	sanitized = sanitized.replace(
		/^\s*console\.(log|warn|error|debug|info)\(.*\);?\s*$/gm,
		"",
	);

	return {
		clean: warnings.length === 0,
		warnings,
		sanitized: sanitized.trim(),
	};
}
