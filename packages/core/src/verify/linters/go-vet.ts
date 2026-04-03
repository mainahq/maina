/**
 * Go vet output parser.
 * Parses `go vet` stderr text output (format: file:line:col: message).
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

export function parseGoVetOutput(output: string): SyntaxDiagnostic[] {
	const diagnostics: SyntaxDiagnostic[] = [];
	const lines = output.split("\n");

	for (const line of lines) {
		if (!line.trim() || line.startsWith("#") || line.startsWith("vet:"))
			continue;

		const match = line.match(/^(.+?):(\d+):(\d+):\s+(.+)$/);
		if (!match) continue;

		const [, file, lineStr, colStr, message] = match;
		if (!file || !lineStr || !message) continue;

		diagnostics.push({
			file,
			line: Number.parseInt(lineStr, 10),
			column: Number.parseInt(colStr ?? "0", 10),
			message,
			severity: "error",
		});
	}

	return diagnostics;
}
