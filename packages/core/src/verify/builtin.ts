/**
 * Built-in Verify Checks — pure-function checks that always run.
 *
 * These provide baseline verification without requiring external linters.
 * Each check is a pure function: (filePath, content) => Finding[].
 * No I/O, no side effects, no subprocess spawns.
 */

import { isCodeFile } from "../language/profile";
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

/**
 * Dev-only tooling at the repo root (`scripts/`, `ci/`) prints to the
 * terminal by design and is not production code; the project's Biome config
 * turns `noConsole` off there too (#380). Only a root-level directory
 * counts, so `packages/x/src/scripts/` is still package source.
 */
const DEV_TOOLING_DIR = /^(?:\.\/)?(?:scripts|ci)\//;

function isDevToolingFile(filePath: string): boolean {
	return DEV_TOOLING_DIR.test(filePath.replaceAll("\\", "/"));
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
 * Test files and dev-only repo tooling (`scripts/`, `ci/`) are excluded
 * since console usage is acceptable there.
 */
export function checkConsoleLogs(filePath: string, content: string): Finding[] {
	if (isTestFile(filePath) || isDevToolingFile(filePath)) return [];

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
			// Drop an inline "type" modifier (`{ A, type B }`) but keep a
			// binding literally named `type` (`{ type as Kind }`), then handle
			// "X as Y" — the local name is Y
			const parts = raw
				.trim()
				.replace(/^type\s+(?!as\s)/, "")
				.split(/\s+as\s+/);
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

/** Secret-bearing key names; `-`/`_` separators cover JSON/YAML spellings. */
const SECRET_KEY =
	"(password|secret|token|api[-_]?key|api[-_]?secret|private[-_]?key|auth[-_]?token)";

/**
 * Key followed by `=` or `:` and a quoted literal. The optional quote after
 * the key covers JSON/YAML quoted keys (`"api_key": "..."`, #391). Values
 * containing `$` or whitespace (variable references, prose) never match.
 */
const QUOTED_SECRET_PATTERN = new RegExp(
	`\\b${SECRET_KEY}["'\`]?\\s*[=:]\\s*["'\`]([^"'\`\\s$]{2,})["'\`]`,
	"gi",
);

/**
 * YAML block-mapping entry with an unquoted scalar value:
 * `  api_key: value  # comment` or `- token: value`. The whole key must be a
 * secret key; flow, anchor, tag, block-scalar and placeholder values are skipped.
 */
const YAML_UNQUOTED_SECRET_PATTERN = new RegExp(
	`^\\s*(?:-\\s+)?["']?${SECRET_KEY}["']?\\s*:\\s+([^\\s"'\`$!&*{}\\[\\]<>|#][^\\s#$]+)\\s*(?:#.*)?$`,
	"i",
);

/** Values that are obviously test fixtures or placeholders, not real secrets. */
const TEST_VALUE_PATTERN =
	/^(test|fake|mock|dummy|example|placeholder|xxx|changeme|TODO|your-|my-|not-real|sk-test|pk-test|<.*>$|\.\.\.|…)/i;

/** Type names and scalar keywords that schema-like files put in the value slot. */
const NON_SECRET_VALUES = new Set([
	"string",
	"str",
	"number",
	"int",
	"integer",
	"float",
	"boolean",
	"bool",
	"object",
	"array",
	"null",
	"none",
	"nil",
	"true",
	"false",
	"yes",
	"no",
	"required",
	"optional",
]);

function isYamlFile(filePath: string): boolean {
	return /\.ya?ml$/i.test(filePath);
}

const normalizeKey = (s: string): string =>
	s.toLowerCase().replace(/[-_]/g, "");

/** Rejects fixtures, schema type names and labels echoing the key ("Password"). */
function isRealSecretValue(key: string, value: string): boolean {
	return (
		!TEST_VALUE_PATTERN.test(value) &&
		!NON_SECRET_VALUES.has(value.toLowerCase()) &&
		normalizeKey(value) !== normalizeKey(key)
	);
}

/**
 * Detect hardcoded secrets: password=, secret=, token=, api_key=, including
 * JSON/YAML key forms (`"api_key": "..."`, and `api_key: value` in YAML),
 * followed by a literal non-empty value (not a variable reference).
 */
export function checkSecrets(filePath: string, content: string): Finding[] {
	// Skip test files — they use fake credentials by definition
	if (isTestFile(filePath)) return [];

	const findings: Finding[] = [];
	const lines = content.split("\n");
	const yaml = isYamlFile(filePath);

	for (const [i, line] of lines.entries()) {
		// Every quoted pair on the line is checked: in minified JSON a skipped
		// placeholder (`"token":"test"`) must not hide a later real secret.
		const candidates: RegExpMatchArray[] = [
			...line.matchAll(QUOTED_SECRET_PATTERN),
		];
		const yamlMatch = yaml ? line.match(YAML_UNQUOTED_SECRET_PATTERN) : null;
		if (yamlMatch) candidates.push(yamlMatch);
		const match = candidates.find(
			(m) => m[1] && m[2] && isRealSecretValue(m[1], m[2]),
		);
		if (match?.[1]) {
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
		/(?::\s*any\b|(?:as|extends|implements)\s+any\b|<any\b|\bany\s*[[\]>,);|&])/;

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
 *
 * Code-smell checks run only on source files. Data and docs files (`.json`,
 * `.jsonl`, `.yml`, `.md`, fixtures, …) often hold code snippets in their
 * strings, so only the hardcoded-secret scan applies to them (#372).
 */
export function runBuiltinChecks(filePath: string, content: string): Finding[] {
	if (!isCodeFile(filePath)) return checkSecrets(filePath, content);
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
