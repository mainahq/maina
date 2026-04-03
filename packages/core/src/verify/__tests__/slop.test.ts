import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectCommentedCode,
	detectConsoleLogs,
	detectEmptyBodies,
	detectHallucinatedImports,
	detectSlop,
	detectTodosWithoutTickets,
} from "../slop";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const TMP_DIR = join(tmpdir(), `maina-slop-test-${Date.now()}`);

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

// ─── Empty Bodies ────────────────────────────────────────────────────────────

describe("SlopDetector", () => {
	describe("detectEmptyBodies", () => {
		it("should detect empty function bodies via AST", () => {
			const content = `function doNothing() {}

function hasBody() {
	return 42;
}

const arrow = () => {};

class Foo {
	method() {}
}`;
			const findings = detectEmptyBodies(content, "src/foo.ts");
			expect(findings.length).toBe(3);
			expect(findings.every((f) => f.ruleId === "slop/empty-body")).toBe(true);
			expect(findings.every((f) => f.tool === "slop")).toBe(true);
			expect(findings.every((f) => f.severity === "warning")).toBe(true);
		});

		it("should not flag function bodies with comments", () => {
			const content = `function placeholder() {
	// TODO(#123): implement later
}`;
			const findings = detectEmptyBodies(content, "src/foo.ts");
			expect(findings.length).toBe(0);
		});

		it("should not flag empty object literals or arrays", () => {
			const content = `const obj = {};
const arr: string[] = [];
const map = new Map();`;
			const findings = detectEmptyBodies(content, "src/foo.ts");
			expect(findings.length).toBe(0);
		});
	});

	// ─── Hallucinated Imports ────────────────────────────────────────────────

	describe("detectHallucinatedImports", () => {
		it("should detect hallucinated imports", () => {
			const content = `import { foo } from "./nonexistent-module";
import { bar } from "../does-not-exist";`;
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "test.ts"),
				TMP_DIR,
			);
			expect(findings.length).toBe(2);
			expect(
				findings.every((f) => f.ruleId === "slop/hallucinated-import"),
			).toBe(true);
			expect(findings.every((f) => f.severity === "error")).toBe(true);
		});

		it("should not flag node_modules imports", () => {
			const content = `import { describe } from "bun:test";
import path from "node:path";
import React from "react";
import { z } from "zod";`;
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "test.ts"),
				TMP_DIR,
			);
			expect(findings.length).toBe(0);
		});

		it("should not flag existing relative imports", () => {
			// Create the imported file
			writeFixture("real-module.ts", "export const x = 1;\n");
			const content = `import { x } from "./real-module";`;
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "importer.ts"),
				TMP_DIR,
			);
			expect(findings.length).toBe(0);
		});
	});

	// ─── Console Logs ────────────────────────────────────────────────────────

	describe("detectConsoleLogs", () => {
		it("should detect console.log in production code", () => {
			const content = `function greet(name: string): void {
	console.log("Hello", name);
	console.warn("deprecated");
	console.error("something broke");
	console.debug("trace info");
	console.info("status update");
}`;
			const findings = detectConsoleLogs(content, "src/app.ts");
			expect(findings.length).toBe(5);
			expect(findings.every((f) => f.ruleId === "slop/console-log")).toBe(true);
			expect(findings.every((f) => f.severity === "warning")).toBe(true);
		});

		it("should not flag console.log in test files", () => {
			const content = `console.log("debugging test");`;
			const findingsTest = detectConsoleLogs(content, "src/app.test.ts");
			const findingsSpec = detectConsoleLogs(content, "src/app.spec.ts");
			expect(findingsTest.length).toBe(0);
			expect(findingsSpec.length).toBe(0);
		});

		it("should not flag files without console usage", () => {
			const content = `function add(a: number, b: number): number {
	return a + b;
}`;
			const findings = detectConsoleLogs(content, "src/math.ts");
			expect(findings.length).toBe(0);
		});
	});

	// ─── Bare TODOs missing ticket ──────────────────────────────────────────

	describe("detectTodosWithoutTickets", () => {
		it("should detect TODO without ticket reference", () => {
			const content = `// TODO: fix this later
/* TODO implement error handling */
// TODO add caching`;
			const findings = detectTodosWithoutTickets(content, "src/app.ts");
			expect(findings.length).toBe(3);
			expect(
				findings.every((f) => f.ruleId === "slop/todo-without-ticket"),
			).toBe(true);
			expect(findings.every((f) => f.severity === "info")).toBe(true);
		});

		it("should not flag TODO with ticket references", () => {
			const content = `// TODO(#123): fix this later
/* TODO PROJ-456: implement error handling */
// TODO [#789] add caching
// TODO(MAINA-42): refactor`;
			const findings = detectTodosWithoutTickets(content, "src/app.ts");
			expect(findings.length).toBe(0);
		});
	});

	// ─── Commented-out code ──────────────────────────────────────────────────

	describe("detectCommentedCode", () => {
		it("should detect commented-out code blocks > 3 lines", () => {
			const content = `function active() {
	return 1;
}

// const old = require("old-module");
// function deprecated() {
//   return old.doStuff();
// }

function alsoActive() {
	return 2;
}`;
			const findings = detectCommentedCode(content, "src/app.ts");
			expect(findings.length).toBe(1);
			expect(findings[0]?.ruleId).toBe("slop/commented-code");
			expect(findings[0]?.severity).toBe("warning");
		});

		it("should not flag short comment blocks", () => {
			const content = `// This is a normal comment
// that spans two lines
function foo() {
	return 1;
}`;
			const findings = detectCommentedCode(content, "src/app.ts");
			expect(findings.length).toBe(0);
		});

		it("should not flag documentation comments", () => {
			const content = `/**
 * This function does something important.
 * It takes a number and returns it doubled.
 * @param n - the number to double
 * @returns the doubled number
 */
function double(n: number): number {
	return n * 2;
}`;
			const findings = detectCommentedCode(content, "src/app.ts");
			expect(findings.length).toBe(0);
		});
	});

	// ─── Cache integration ───────────────────────────────────────────────────

	describe("cache integration", () => {
		it("should cache results for unchanged files", async () => {
			const filePath = writeFixture(
				"cached.ts",
				`function empty() {}\nconsole.log("hello");\n`,
			);

			// Create a mock cache manager
			const store = new Map<string, { value: string }>();
			const mockCache = {
				get(key: string) {
					const entry = store.get(key);
					if (!entry) return null;
					return {
						key,
						value: entry.value,
						createdAt: Date.now(),
						ttl: 0,
					};
				},
				set(key: string, value: string) {
					store.set(key, { value });
				},
				has(key: string) {
					return store.has(key);
				},
				invalidate(key: string) {
					store.delete(key);
				},
				clear() {
					store.clear();
				},
				stats() {
					return {
						l1Hits: 0,
						l2Hits: 0,
						misses: 0,
						totalQueries: 0,
						entriesL1: 0,
						entriesL2: 0,
					};
				},
			};

			// First call — should not be cached
			const result1 = await detectSlop([filePath], {
				cache: mockCache,
				cwd: TMP_DIR,
			});
			expect(result1.cached).toBe(false);
			expect(result1.findings.length).toBeGreaterThan(0);

			// Second call — same file, should be cached
			const result2 = await detectSlop([filePath], {
				cache: mockCache,
				cwd: TMP_DIR,
			});
			expect(result2.cached).toBe(true);
			expect(result2.findings.length).toBe(result1.findings.length);
		});
	});

	// ─── Integration: detectSlop ─────────────────────────────────────────────

	describe("detectSlop integration", () => {
		it("should detect console.log in a file", async () => {
			const filePath = writeFixture(
				"with-console.ts",
				`export function greet(): void {\n\tconsole.log("hello");\n}\n`,
			);
			const result = await detectSlop([filePath], { cwd: TMP_DIR });
			expect(result.findings.length).toBeGreaterThan(0);
			expect(result.findings.some((f) => f.ruleId === "slop/console-log")).toBe(
				true,
			);
		});

		it("should return clean for a file without slop", async () => {
			const filePath = writeFixture(
				"clean.ts",
				`export function add(a: number, b: number): number {\n\treturn a + b;\n}\n`,
			);
			const result = await detectSlop([filePath], { cwd: TMP_DIR });
			expect(result.findings.length).toBe(0);
		});
	});
});
