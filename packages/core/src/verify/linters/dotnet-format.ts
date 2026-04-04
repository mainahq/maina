/**
 * dotnet format output parser for C# linting.
 * Parses `dotnet format --verify-no-changes` output.
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

/**
 * Parse dotnet format text output into SyntaxDiagnostic[].
 * dotnet format outputs: "path/file.cs(line,col): severity CODE: message"
 */
export function parseDotnetFormatOutput(output: string): SyntaxDiagnostic[] {
	const diagnostics: SyntaxDiagnostic[] = [];
	const lines = output.split("\n");

	for (const line of lines) {
		if (!line.trim()) continue;
		// Format: file.cs(line,col): warning CS1234: message
		const match = line.match(
			/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(\w+):\s*(.+)$/,
		);
		if (!match) continue;

		const [, file, lineStr, colStr, severity, _code, message] = match;
		if (!file || !lineStr || !message) continue;

		diagnostics.push({
			file,
			line: Number.parseInt(lineStr, 10),
			column: Number.parseInt(colStr ?? "0", 10),
			message,
			severity: severity === "error" ? "error" : "warning",
		});
	}

	return diagnostics;
}
