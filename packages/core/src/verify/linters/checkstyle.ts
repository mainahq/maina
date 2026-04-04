/**
 * Checkstyle output parser for Java linting.
 * Parses Checkstyle XML output.
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

/**
 * Parse Checkstyle XML output into SyntaxDiagnostic[].
 */
export function parseCheckstyleOutput(xml: string): SyntaxDiagnostic[] {
	const diagnostics: SyntaxDiagnostic[] = [];

	// Simple XML parsing — extract <error> elements
	// Format: <file name="path"><error line="10" column="5" severity="error" message="desc" source="rule"/></file>
	const filePattern = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/g;
	const errorPattern =
		/<error\s+line="(\d+)"\s+(?:column="(\d+)"\s+)?severity="(\w+)"\s+message="([^"]+)"/g;

	for (const fileMatch of xml.matchAll(filePattern)) {
		const filePath = fileMatch[1] ?? "";
		const fileContent = fileMatch[2] ?? "";

		for (const errorMatch of fileContent.matchAll(errorPattern)) {
			const line = Number.parseInt(errorMatch[1] ?? "0", 10);
			const column = Number.parseInt(errorMatch[2] ?? "0", 10);
			const severity = errorMatch[3] ?? "warning";
			const message = errorMatch[4] ?? "";

			diagnostics.push({
				file: filePath,
				line,
				column,
				message,
				severity: severity === "error" ? "error" : "warning",
			});
		}
	}

	return diagnostics;
}
