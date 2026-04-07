import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCodeEntities } from "../../extractors/code";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-code-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(join(tmpDir, "src"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Code Entity Extractor", () => {
	describe("extractCodeEntities", () => {
		it("happy path: should extract entities from TypeScript files", () => {
			writeFileSync(
				join(tmpDir, "src", "math.ts"),
				[
					"export function add(a: number, b: number): number {",
					"  return a + b;",
					"}",
					"",
					"export function multiply(a: number, b: number): number {",
					"  return a * b;",
					"}",
					"",
					"export interface Calculator {",
					"  compute(expr: string): number;",
					"}",
				].join("\n"),
			);

			const result = extractCodeEntities(tmpDir, ["src/math.ts"]);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			// Should find exported functions and interfaces
			expect(result.value.length).toBeGreaterThan(0);
			const names = result.value.map((e) => e.name);
			expect(names).toContain("add");
			expect(names).toContain("multiply");
			expect(names).toContain("Calculator");
		});

		it("should include file path and entity kind", () => {
			writeFileSync(
				join(tmpDir, "src", "types.ts"),
				[
					"export type Status = 'active' | 'inactive';",
					"",
					"export const VERSION = '1.0.0';",
				].join("\n"),
			);

			const result = extractCodeEntities(tmpDir, ["src/types.ts"]);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			for (const entity of result.value) {
				expect(entity.file).toBeTruthy();
				expect(entity.kind).toBeTruthy();
				expect(entity.name).toBeTruthy();
			}
		});

		it("should handle empty file list", () => {
			const result = extractCodeEntities(tmpDir, []);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toHaveLength(0);
		});

		it("should handle non-existent files gracefully", () => {
			const result = extractCodeEntities(tmpDir, ["src/nonexistent.ts"]);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toHaveLength(0);
		});

		it("edge case: file with no exports", () => {
			writeFileSync(
				join(tmpDir, "src", "internal.ts"),
				"const secret = 42;\nfunction helper() { return secret; }\n",
			);

			const result = extractCodeEntities(tmpDir, ["src/internal.ts"]);
			expect(result.ok).toBe(true);
			// May or may not have entities depending on parser — but should not error
		});
	});
});
