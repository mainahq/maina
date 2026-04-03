/**
 * Ruff output parser for Python syntax/lint checking.
 * Parses `ruff check --output-format=json` output.
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

/**
 * Parse ruff JSON output into SyntaxDiagnostic[].
 * F-codes (pyflakes) are errors, E-codes (pycodestyle) are warnings.
 */
export function parseRuffOutput(json: string): SyntaxDiagnostic[] {
	let items: unknown[];
	try {
		items = JSON.parse(json);
	} catch {
		return [];
	}

	if (!Array.isArray(items)) return [];

	const diagnostics: SyntaxDiagnostic[] = [];

	for (const item of items) {
		const i = item as Record<string, unknown>;
		const code = (i.code as string) ?? "";
		const message = (i.message as string) ?? "";
		const filename = (i.filename as string) ?? "";
		const location = i.location as Record<string, number> | undefined;
		const row = location?.row ?? 0;
		const column = location?.column ?? 0;

		const severity: "error" | "warning" = code.startsWith("F")
			? "error"
			: "warning";

		diagnostics.push({
			file: filename,
			line: row,
			column,
			message: `${code}: ${message}`,
			severity,
		});
	}

	return diagnostics;
}
