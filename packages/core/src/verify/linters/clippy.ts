/**
 * Clippy output parser for Rust linting.
 * Parses `cargo clippy --message-format=json` output.
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

export function parseClippyOutput(output: string): SyntaxDiagnostic[] {
	const diagnostics: SyntaxDiagnostic[] = [];
	const lines = output.split("\n");

	for (const line of lines) {
		if (!line.trim()) continue;

		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		if (parsed.reason !== "compiler-message") continue;

		const msg = parsed.message as Record<string, unknown> | undefined;
		if (!msg) continue;

		const level = (msg.level as string) ?? "warning";
		const message = (msg.message as string) ?? "";
		const code = (msg.code as Record<string, string> | undefined)?.code ?? "";
		const spans = msg.spans as Array<Record<string, unknown>> | undefined;

		if (!spans || spans.length === 0) continue;

		const span = spans[0] as Record<string, unknown>;
		const fileName = (span.file_name as string) ?? "";
		const lineStart = (span.line_start as number) ?? 0;
		const columnStart = (span.column_start as number) ?? 0;

		const severity: "error" | "warning" =
			level === "error" ? "error" : "warning";

		diagnostics.push({
			file: fileName,
			line: lineStart,
			column: columnStart,
			message: code ? `${code}: ${message}` : message,
			severity,
		});
	}

	return diagnostics;
}
