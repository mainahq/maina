import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfile } from "../../language/profile";
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

		// #399 — import-like text inside comments is not an import
		it("should not flag an import quoted inside a JSDoc comment", () => {
			const content = [
				"export interface ImportRecord {",
				'\t/** Empty for a side-effect import (`import "./polyfill"`, `require("x")`). */',
				"\tnames: string[];",
				"}",
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "types.ts"),
				TMP_DIR,
			);
			expect(findings).toHaveLength(0);
		});

		it("should not flag imports inside multi-line block comments", () => {
			const content = [
				"/**",
				" * Usage:",
				' * import { foo } from "./missing-a";',
				'import "./missing-b";',
				' require("./missing-c");',
				" */",
				"export const x = 1;",
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "doc.ts"),
				TMP_DIR,
			);
			expect(findings).toHaveLength(0);
		});

		it("should not flag imports inside line comments", () => {
			const content = [
				'// import { foo } from "./missing-a";',
				'const y = 1; // was: require("./missing-b")',
				'\t// import "./missing-c";',
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "line.ts"),
				TMP_DIR,
			);
			expect(findings).toHaveLength(0);
		});

		it("should not flag import-like text inside string literals", () => {
			const content = [
				"const hint = 'Try: import { foo } from \"./missing-a\"';",
				'const tpl = `import "./missing-b"`;',
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "strings.ts"),
				TMP_DIR,
			);
			expect(findings).toHaveLength(0);
		});

		it("still flags real imports next to comments", () => {
			const content = [
				"/* header */",
				'import { a } from "./missing-a"; // trailing note',
				'import "./missing-b";',
				'const c = require("./missing-c");',
				'/* inline */ import { d } from "./missing-d";',
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "real.ts"),
				TMP_DIR,
			);
			expect(findings.map((f) => f.line)).toEqual([2, 3, 4, 5]);
		});

		it("should not flag imports inside multi-line template literals", () => {
			const content = [
				"const scaffold = `",
				'import { foo } from "./missing-a";',
				'import "./missing-b";',
				"`;",
				'import { real } from "./missing-c";',
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "scaffold.ts"),
				TMP_DIR,
			);
			expect(findings.map((f) => f.line)).toEqual([5]);
		});

		// #399 review — a quote, backtick or `/*` inside a regex literal must
		// not flip the lexer into string/template/comment state and hide the
		// real imports that follow (fail-open).
		it("still flags imports after regex literals holding quotes or /*", () => {
			const content = [
				"const TRAIL = /\\/*$/;",
				'const a = require("./missing-a");',
				"const QUOTES = /[`'\"]/;",
				'const b = require("./missing-b");',
				'const c = (s) => /\'/.test(s) && require("./missing-c");',
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "regex.ts"),
				TMP_DIR,
			);
			expect(findings.map((f) => f.line)).toEqual([2, 4, 5]);
		});

		it("should not flag import-like text inside a regex literal", () => {
			const content = 'const RE = /x|require("..[/]missing-a")/;';
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "regex-text.ts"),
				TMP_DIR,
			);
			expect(findings).toHaveLength(0);
		});

		it("treats a slash after an operand as division, not a regex", () => {
			const content = [
				'const half = total / 2; const a = require("./missing-a");',
				'const r = (a) / (b); const b = require("./missing-b");',
			].join("\n");
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "divide.ts"),
				TMP_DIR,
			);
			expect(findings.map((f) => f.line)).toEqual([1, 2]);
		});

		it("flags re-exports from missing modules", () => {
			const content =
				'export { a } from "./missing-a";\nexport * from "./missing-b";';
			const findings = detectHallucinatedImports(
				content,
				join(TMP_DIR, "barrel.ts"),
				TMP_DIR,
			);
			expect(findings.map((f) => f.line)).toEqual([1, 2]);
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

		it("should still detect commented-out code without semicolons", () => {
			const content = `// if (user.isAdmin) {
//   grantAccess(user)
//   audit.log("granted", user.id)
// }
export const x = 1;`;
			const findings = detectCommentedCode(content, "src/app.ts");
			expect(findings.length).toBe(1);
			expect(findings[0]?.line).toBe(1);
		});

		// Review on #394: keywords are not prose words, so keyword-dense
		// code without statement terminators is still caught.
		it.each([
			[
				"control flow",
				`// for (const item of items)
//   if (item) return item
//   else if (fallback) return other`,
			],
			[
				"type casts",
				`// const foo = bar as unknown as Baz
// const qux = foo as unknown as Quux
// return foo satisfies Baz as Q`,
			],
			[
				"type-only imports",
				`// import type Foo from "./foo"
// import type Bar from "./bar"
// import type Baz from "./baz"`,
			],
			[
				"class declarations",
				`// export default class Foo extends Bar
// export class Qux extends Base implements Thing
// export const y = z as unknown as Z`,
			],
		])("should still detect keyword-dense commented-out code (%s)", (_label, code) => {
			const content = `${code}\nexport const x = 1;`;
			const findings = detectCommentedCode(content, "src/app.ts");
			expect(findings.length).toBe(1);
			expect(findings[0]?.line).toBe(1);
		});

		// #394: prose explanations that happen to contain parentheses,
		// backtick code spans or keywords are not commented-out code.
		it.each([
			[
				"parenthetical asides",
				`		// No receipts directory at all → nothing to check (e.g. fresh
		// checkout). The docs workflow has its own "fail if missing"
		// guard for the publish path; this script stays advisory here.`,
			],
			[
				"backtick code spans",
				`	// Commander does not expose a public \`.hidden()\` method but respects
	// the internal \`_hidden\` flag when rendering \`helpInformation()\`.
	// Setting it keeps the command callable while removing it from the`,
			],
			[
				"issue references and quoted output",
				`		// Defensive: a malformed server payload (missing path/content) used to
		// throw out of the loop and leave \`@clack/prompts\`' spinner monitor to
		// print a generic "Something went wrong" (see #196).`,
			],
			[
				"sentences that start with keywords",
				`	// If the file is missing, return an Err so the caller decides;
	// for a stale cache (older than one day) we fall back to the
	// default config (which is always safe to load).`,
			],
		])("should not flag prose comment blocks with %s", (_label, prose) => {
			const content = `function f() {\n${prose}\n\treturn 1;\n}\n`;
			const findings = detectCommentedCode(content, "src/app.ts");
			expect(findings).toEqual([]);
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

		it("ignores v2 cache entries written before data files were skipped (#372)", async () => {
			const codePath = writeFixture("stale-cache.ts", "export const ok = 1;\n");
			// A pre-#372 entry for identical content scanned as a .json file
			const stale = JSON.stringify([
				{
					tool: "slop",
					file: "fixtures/data.json",
					line: 1,
					message: "Import './missing' does not resolve",
					severity: "error",
					ruleId: "slop/hallucinated-import",
				},
			]);
			const staleCache = {
				get(key: string) {
					if (!key.startsWith("slop:v2:")) return null;
					return { key, value: stale, createdAt: Date.now(), ttl: 0 };
				},
				set() {},
				has(key: string) {
					return key.startsWith("slop:v2:");
				},
				invalidate() {},
				clear() {},
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
			const result = await detectSlop([codePath], {
				cache: staleCache,
				cwd: TMP_DIR,
			});
			expect(result.findings).toEqual([]);
			expect(result.cached).toBe(false);
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

	// ─── Non-code data files (#372) ─────────────────────────────────────────

	describe("non-code data files", () => {
		// A golden-style fixture: JSON whose string values hold a recorded diff
		// with relative imports, console.log and TODOs. None of it is code.
		const jsonFixture = `${JSON.stringify(
			{
				site: "review/index.ts#code-quality",
				input: {
					diff: [
						"+import { CLOUD_FAQ } from '../data/cloud-landing';",
						"+import helper from './missing-helper';",
						"+const x = require('./not-here');",
						"+console.log('debug');",
						"+// TODO: wire this up",
						"+function noop() {}",
					].join("\n"),
				},
			},
			null,
			"\t",
		)}\n`;

		it("detectHallucinatedImports skips .json files with import-like strings", () => {
			const findings = detectHallucinatedImports(
				jsonFixture,
				"packages/core/src/__golden__/decisions/review.json",
				TMP_DIR,
			);
			expect(findings).toHaveLength(0);
		});

		it("detectHallucinatedImports skips .jsonl, .yml, .yaml and .md files", () => {
			const content = 'import x from "./missing";\n';
			for (const file of ["data.jsonl", "ci.yml", "ci.yaml", "notes.md"]) {
				expect(detectHallucinatedImports(content, file, TMP_DIR)).toHaveLength(
					0,
				);
			}
		});

		it("detectHallucinatedImports still flags code files (.ts, .mjs, .cjs)", () => {
			const content = 'import x from "./missing";\n';
			for (const file of ["mod.ts", "mod.mjs", "mod.cjs"]) {
				expect(detectHallucinatedImports(content, file, TMP_DIR)).toHaveLength(
					1,
				);
			}
		});

		it("detectSlop returns no findings for a JSON fixture", async () => {
			const filePath = writeFixture("golden-fixture.json", jsonFixture);
			const result = await detectSlop([filePath], { cwd: TMP_DIR });
			expect(result.findings).toEqual([]);
		});

		it("detectSlop still reports code files passed alongside data files", async () => {
			const jsonPath = writeFixture("mixed-fixture.json", jsonFixture);
			const codePath = writeFixture(
				"mixed-code.ts",
				'import x from "./missing";\nexport const y = x;\n',
			);
			const result = await detectSlop([jsonPath, codePath], { cwd: TMP_DIR });
			expect(result.findings.map((f) => f.file)).toEqual([codePath]);
			expect(result.findings[0]?.ruleId).toBe("slop/hallucinated-import");
		});
	});

	// ─── Language-aware slop detection ──────────────────────────────────────

	describe("language-aware slop detection", () => {
		it("should detect print() in Python files", () => {
			const findings = detectConsoleLogs(
				"x = 1\nprint('debug')\ny = 2",
				"app.py",
				getProfile("python"),
			);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.ruleId).toBe("slop/console-log");
		});

		it("should detect fmt.Println in Go files", () => {
			const findings = detectConsoleLogs(
				"package main\nfmt.Println(x)\n",
				"main.go",
				getProfile("go"),
			);
			expect(findings).toHaveLength(1);
		});

		it("should detect println! in Rust files", () => {
			const findings = detectConsoleLogs(
				'fn main() {\n  println!("debug");\n}',
				"main.rs",
				getProfile("rust"),
			);
			expect(findings).toHaveLength(1);
		});

		it("should skip Python test files", () => {
			const findings = detectConsoleLogs(
				"print('ok')",
				"test_app.py",
				getProfile("python"),
			);
			expect(findings).toHaveLength(0);
		});

		it("should skip Go test files", () => {
			const findings = detectConsoleLogs(
				"fmt.Println(x)",
				"app_test.go",
				getProfile("go"),
			);
			expect(findings).toHaveLength(0);
		});

		it("should still work without profile (backward compatible)", () => {
			const findings = detectConsoleLogs("console.log('test')", "app.ts");
			expect(findings).toHaveLength(1);
		});
	});
});
