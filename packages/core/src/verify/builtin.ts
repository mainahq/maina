/**
 * Built-in Verify Checks — pure-function checks that always run.
 *
 * These provide baseline verification without requiring external linters.
 * Each check is a pure function: (filePath, content) => Finding[].
 * No I/O, no side effects, no subprocess spawns.
 */

import type { Finding } from "./diff-filter";

// ─── Helpers ─────────────────────────────────────────────────────────────

function isTestFile(filePath: string): boolean {
	return (
		filePath.endsWith(".test.ts") ||
		filePath.endsWith(".test.tsx") ||
		filePath.endsWith(".test.js") ||
		filePath.endsWith(".test.jsx") ||
		filePath.endsWith(".spec.ts") ||
		filePath.endsWith(".spec.tsx") ||
		filePath.endsWith(".spec.js") ||
		filePath.endsWith(".spec.jsx") ||
		filePath.includes("__tests__/")
	);
}

function isDeclarationFile(filePath: string): boolean {
	return filePath.endsWith(".d.ts");
}

function isTypeScriptFile(filePath: string): boolean {
	return (
		filePath.endsWith(".ts") ||
		filePath.endsWith(".tsx") ||
		filePath.endsWith(".mts") ||
		filePath.endsWith(".cts")
	);
}

// ─── Check 1: console.log in non-test files ─────────────────────────────

/**
 * Detect console.log/warn/error/debug/info calls in production code.
 * Test files are excluded since console usage is acceptable there.
 */
export function checkConsoleLogs(filePath: string, content: string): Finding[] {
	if (isTestFile(filePath)) return [];

	const findings: Finding[] = [];
	const lines = content.split("\n");
	const consolePattern = /\bconsole\.(log|warn|error|debug|info)\s*\(/;

	for (const [i, line] of lines.entries()) {
		if (consolePattern.test(line)) {
			findings.push({
				tool: "builtin",
				file: filePath,
				line: i + 1,
				message: `console.${line.match(consolePattern)?.[1]} found in production code`,
				severity: "warning",
				ruleId: "no-console-log",
			});
		}
	}

	return findings;
}

// ─── Check 2: Unused imports ─────────────────────────────────────────────

/**
 * Best-effort regex check for unused named imports.
 * Looks for `import { X, Y }` where identifiers don't appear
 * elsewhere in the file. Prefers false negatives over false positives.
 */
export function checkUnusedImports(
	filePath: string,
	content: string,
): Finding[] {
	const findings: Finding[] = [];
	const lines = content.split("\n");

	// Match named imports: import { A, B } from "..." or import type { A } from "..."
	const importLinePattern =
		/^import\s+(?:type\s+)?{([^}]+)}\s+from\s+["'][^"']+["'];?\s*$/;

	for (const [i, line] of lines.entries()) {
		const match = line.match(importLinePattern);
		if (!match) continue;

		// Check if this is a type-only import (import type { ... })
		const isTypeImport = /^import\s+type\s+\{/.test(line);

		const rawNames = match[1]?.split(",") ?? [];
		const importedNames: string[] = [];
		for (const raw of rawNames) {
			// Handle "X as Y" — the local name is Y
			const parts = raw.trim().split(/\s+as\s+/);
			const resolved = (parts.length > 1 ? parts[1] : parts[0])?.trim() ?? "";
			if (resolved.length > 0) {
				importedNames.push(resolved);
			}
		}

		// Get the rest of the file content (excluding import lines)
		const restOfFile = lines
			.filter((l) => !importLinePattern.test(l))
			.join("\n");

		for (const name of importedNames) {
			// Check if the identifier appears in the rest of the file
			// Use word boundary to avoid matching substrings
			const usagePattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
			if (!usagePattern.test(restOfFile)) {
				findings.push({
					tool: "builtin",
					file: filePath,
					line: i + 1,
					message: `Import '${name}' appears unused${isTypeImport ? " (type import)" : ""}`,
					severity: "warning",
					ruleId: "unused-import",
				});
			}
		}
	}

	return findings;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Check 3: TODO/FIXME/HACK comments ──────────────────────────────────

/**
 * Count and report TODO, FIXME, and HACK markers.
 * These are informational — they don't block verification.
 */
export function checkTodoComments(
	filePath: string,
	content: string,
): Finding[] {
	const findings: Finding[] = [];
	const lines = content.split("\n");
	const todoPattern = /\b(TODO|FIXME|HACK)\b/;

	for (const [i, line] of lines.entries()) {
		const match = line.match(todoPattern);
		if (match) {
			findings.push({
				tool: "builtin",
				file: filePath,
				line: i + 1,
				message: `${match[1]} comment found: ${line.trim()}`,
				severity: "info",
				ruleId: "todo-comment",
			});
		}
	}

	return findings;
}

// ─── Check 4: File size ──────────────────────────────────────────────────

/**
 * Flag files exceeding 500 lines. Large files are harder to review
 * and maintain — consider splitting them.
 */
export function checkFileSize(filePath: string, content: string): Finding[] {
	const lineCount = content.split("\n").length;

	if (lineCount > 500) {
		return [
			{
				tool: "builtin",
				file: filePath,
				line: 1,
				message: `File has ${lineCount} lines (exceeds 500 line limit). Consider splitting.`,
				severity: "warning",
				ruleId: "file-too-long",
			},
		];
	}

	return [];
}

// ─── Check 5: Secrets patterns ──────────────────────────────────────────

/**
 * Detect hardcoded secrets: password=, secret=, token=, api_key=
 * followed by a quoted or literal non-empty value (not a variable reference).
 */
export function checkSecrets(filePath: string, content: string): Finding[] {
	// Skip test files — they use fake credentials by definition
	if (isTestFile(filePath)) return [];

	const findings: Finding[] = [];
	const lines = content.split("\n");

	// Patterns: key followed by = and a hardcoded value (quoted string or bare literal)
	// Does NOT match variable references like process.env.X, ${VAR}, etc.
	const secretPattern =
		/\b(password|secret|token|api_key|apikey|api_secret|private_key|auth_token)\s*[=:]\s*["'`]([^"'`\s$]{2,})["'`]/i;

	// Values that are obviously test fixtures, not real secrets
	const testValuePattern =
		/^(test|fake|mock|dummy|example|placeholder|xxx|changeme|TODO|your-|my-|not-real|sk-test|pk-test)/i;

	for (const [i, line] of lines.entries()) {
		const match = line.match(secretPattern);
		if (match && match[2] && !testValuePattern.test(match[2])) {
			findings.push({
				tool: "builtin",
				file: filePath,
				line: i + 1,
				message: `Possible hardcoded ${match[1]} detected`,
				severity: "error",
				ruleId: "hardcoded-secret",
			});
		}
	}

	return findings;
}

// ─── Check 6: Empty catch blocks ─────────────────────────────────────────

/**
 * Detect empty catch blocks (no statements, no comments).
 * A catch with only whitespace is still flagged.
 * A catch with a comment is considered intentional and allowed.
 */
export function checkEmptyCatch(filePath: string, content: string): Finding[] {
	const findings: Finding[] = [];
	const lines = content.split("\n");

	for (const [i, line] of lines.entries()) {
		// Match catch on same line: catch (e) {}
		// or catch (e) {  } (with just whitespace)
		const inlineMatch = line.match(/\bcatch\s*\([^)]*\)\s*\{\s*\}\s*$/);
		if (inlineMatch) {
			findings.push({
				tool: "builtin",
				file: filePath,
				line: i + 1,
				message: "Empty catch block — errors are silently swallowed",
				severity: "warning",
				ruleId: "empty-catch",
			});
			continue;
		}

		// Multi-line catch: catch (e) { on this line, } on a later line
		const catchOpenMatch = line.match(/\bcatch\s*\([^)]*\)\s*\{\s*$/);
		if (catchOpenMatch) {
			// Look ahead for the closing brace
			let blockContent = "";
			let closingLine = -1;
			for (let j = i + 1; j < lines.length && j < i + 20; j++) {
				const nextLine = lines[j] ?? "";
				if (nextLine.trim() === "}") {
					closingLine = j;
					break;
				}
				blockContent += nextLine;
			}

			if (closingLine !== -1) {
				const trimmed = blockContent.trim();
				// Empty or whitespace-only is flagged
				// Comments are intentional — not flagged
				if (trimmed === "") {
					findings.push({
						tool: "builtin",
						file: filePath,
						line: i + 1,
						message: "Empty catch block — errors are silently swallowed",
						severity: "warning",
						ruleId: "empty-catch",
					});
				}
				// If it contains a comment (// or /* or *), it's intentional
				// If it contains actual code, it's not empty
				// Either way, no finding needed
			}
		}
	}

	return findings;
}

// ─── Check 7: `any` type usage ───────────────────────────────────────────

/**
 * Detect `any` type annotations in TypeScript files.
 * Skips .d.ts files where `any` is sometimes necessary.
 * Avoids false positives on words containing "any" (e.g., "many", "company")
 * and on comments/strings.
 */
export function checkAnyType(filePath: string, content: string): Finding[] {
	if (!isTypeScriptFile(filePath)) return [];
	if (isDeclarationFile(filePath)) return [];

	const findings: Finding[] = [];
	const lines = content.split("\n");

	// Match `: any`, `as any`, `<any>`, `any[]`, `any,`, `any)`, `any;`
	// — basically `any` used as a type annotation, not as a substring in identifiers
	const anyTypePattern =
		/(?::\s*any\b|(?:as|extends|implements)\s+any\b|<any\b|any\s*[[\]>,);|&])/;

	for (const [i, line] of lines.entries()) {
		// Skip comment lines
		const trimmed = line.trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

		// Skip lines where 'any' only appears in a string literal
		// Simple heuristic: remove string contents and check again
		const withoutStrings = line
			.replace(/"(?:[^"\\]|\\.)*"/g, '""')
			.replace(/'(?:[^'\\]|\\.)*'/g, "''")
			.replace(/`(?:[^`\\]|\\.)*`/g, "``");

		if (anyTypePattern.test(withoutStrings)) {
			findings.push({
				tool: "builtin",
				file: filePath,
				line: i + 1,
				message: "Usage of 'any' type — prefer explicit types or 'unknown'",
				severity: "warning",
				ruleId: "no-any-type",
			});
		}
	}

	return findings;
}

// ─── Aggregator ──────────────────────────────────────────────────────────

/**
 * Run all built-in checks on a single file and return aggregated findings.
 */
export function runBuiltinChecks(filePath: string, content: string): Finding[] {
	return [
		...checkConsoleLogs(filePath, content),
		...checkUnusedImports(filePath, content),
		...checkTodoComments(filePath, content),
		...checkFileSize(filePath, content),
		...checkSecrets(filePath, content),
		...checkEmptyCatch(filePath, content),
		...checkAnyType(filePath, content),
	];
}
