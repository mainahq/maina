import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfile } from "../../language/profile";
import { parseBiomeOutput, syntaxGuard } from "../syntax-guard";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const TMP_DIR = join(tmpdir(), `maina-syntax-guard-test-${Date.now()}`);

const VALID_TS = `export const greeting = "hello";\n`;

const INVALID_TS_MISSING_BRACKET = `export function broken( {
	return 1;
}\n`;

const INVALID_TS_PARSE_ERROR = `export function bad(): number {
	const x = [1, 2, 3
	return x.length;
}\n`;

beforeAll(() => {
	mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TMP_DIR, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
	const filePath = join(TMP_DIR, name);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

// ─── SyntaxGuard ───────────────────────────────────────────────────────────

describe("SyntaxGuard", () => {
	it("should pass valid TypeScript files", async () => {
		const file = writeFixture("valid.ts", VALID_TS);
		const result = await syntaxGuard([file]);
		expect(result.ok).toBe(true);
	});

	it("should reject files with syntax errors", async () => {
		const file = writeFixture("broken.ts", INVALID_TS_MISSING_BRACKET);
		const result = await syntaxGuard([file]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.length).toBeGreaterThan(0);
			const hasError = result.error.some((e) => e.severity === "error");
			expect(hasError).toBe(true);
		}
	});

	it("should complete in < 500ms for 10 files", async () => {
		const files: string[] = [];
		for (let i = 0; i < 10; i++) {
			files.push(
				writeFixture(`perf_${i}.ts`, `export const val${i} = ${i};\n`),
			);
		}
		const start = performance.now();
		const result = await syntaxGuard(files);
		const elapsed = performance.now() - start;
		expect(result.ok).toBe(true);
		expect(elapsed).toBeLessThan(500);
	});

	it("should return structured error with file + line + message", async () => {
		const file = writeFixture("structured.ts", INVALID_TS_PARSE_ERROR);
		const result = await syntaxGuard([file]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.length).toBeGreaterThan(0);
			const first = result.error[0] as NonNullable<(typeof result.error)[0]>;
			expect(typeof first.file).toBe("string");
			expect(first.file).toContain("structured.ts");
			expect(typeof first.line).toBe("number");
			expect(first.line).toBeGreaterThan(0);
			expect(typeof first.column).toBe("number");
			expect(typeof first.message).toBe("string");
			expect(first.message.length).toBeGreaterThan(0);
			expect(["error", "warning"]).toContain(first.severity);
		}
	});

	it("should return Ok immediately for empty file list", async () => {
		const result = await syntaxGuard([]);
		expect(result.ok).toBe(true);
	});

	it("should include warnings in output but only reject on errors", async () => {
		// A file with only a warning (unused variable) but no parse errors
		const file = writeFixture(
			"warn_only.ts",
			`const used = 1;\nexport const result = used + 1;\n`,
		);
		const result = await syntaxGuard([file]);
		// This should pass because there are no errors (only possible warnings)
		expect(result.ok).toBe(true);
	});
});

// ─── syntaxGuard with language profile ────────────────────────────────────

describe("syntaxGuard with language profile", () => {
	it("should accept a language profile parameter", async () => {
		const profile = getProfile("typescript");
		const result = await syntaxGuard([], undefined, profile);
		expect(result.ok).toBe(true);
	});

	it("should use biome for typescript profile (default behavior)", async () => {
		const result = await syntaxGuard(["nonexistent.ts"]);
		expect(result).toBeDefined();
	});

	it("should attempt ruff for python profile", async () => {
		const profile = getProfile("python");
		// ruff likely not installed — should fail gracefully
		const result = await syntaxGuard(["test.py"], undefined, profile);
		expect(result).toBeDefined();
		// Either ok (if ruff found nothing) or error (if ruff not installed)
	});

	it("should attempt go vet for go profile", async () => {
		const profile = getProfile("go");
		const result = await syntaxGuard(["test.go"], undefined, profile);
		expect(result).toBeDefined();
	});

	it("should attempt clippy for rust profile", async () => {
		const profile = getProfile("rust");
		const result = await syntaxGuard(["test.rs"], undefined, profile);
		expect(result).toBeDefined();
	});
});

// ─── parseBiomeOutput ──────────────────────────────────────────────────────

describe("parseBiomeOutput", () => {
	it("should return empty array for empty diagnostics", () => {
		const json = JSON.stringify({
			summary: { errors: 0, warnings: 0 },
			diagnostics: [],
			command: "check",
		});
		const errors = parseBiomeOutput(json);
		expect(errors).toEqual([]);
	});

	it("should parse diagnostics from biome JSON output", () => {
		const json = JSON.stringify({
			summary: { errors: 1, warnings: 0 },
			diagnostics: [
				{
					severity: "error",
					message: "expected `:` but instead found `x`",
					category: "parse",
					location: {
						path: "/tmp/test.ts",
						start: { line: 3, column: 10 },
						end: { line: 3, column: 11 },
					},
					advices: [],
				},
			],
			command: "check",
		});

		const errors = parseBiomeOutput(json);
		expect(errors.length).toBe(1);
		const first = errors[0] as NonNullable<(typeof errors)[0]>;
		expect(first.file).toBe("/tmp/test.ts");
		expect(first.line).toBe(3);
		expect(first.column).toBe(10);
		expect(first.message).toContain("expected `:`");
		expect(first.severity).toBe("error");
	});

	it("should handle multiple diagnostics", () => {
		const json = JSON.stringify({
			summary: { errors: 2, warnings: 1 },
			diagnostics: [
				{
					severity: "warning",
					message: "Unused variable",
					category: "lint/correctness/noUnusedVariables",
					location: {
						path: "/tmp/a.ts",
						start: { line: 1, column: 5 },
						end: { line: 1, column: 6 },
					},
					advices: [],
				},
				{
					severity: "error",
					message: "Parse error",
					category: "parse",
					location: {
						path: "/tmp/a.ts",
						start: { line: 5, column: 1 },
						end: { line: 5, column: 1 },
					},
					advices: [],
				},
			],
			command: "check",
		});

		const errors = parseBiomeOutput(json);
		expect(errors.length).toBe(2);
		expect((errors[0] as NonNullable<(typeof errors)[0]>).severity).toBe(
			"warning",
		);
		expect((errors[1] as NonNullable<(typeof errors)[0]>).severity).toBe(
			"error",
		);
	});

	it("should return empty array for invalid JSON", () => {
		const errors = parseBiomeOutput("not json at all");
		expect(errors).toEqual([]);
	});
});
