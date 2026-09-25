import { describe, expect, test } from "bun:test";
import { parseFile } from "../index";
import { detectLang, isTestPath } from "../languages";
import { symbolRows } from "./helpers";

describe("detectLang", () => {
	test("maps file extensions to grammars", () => {
		expect(
			[
				"a.ts",
				"a.mts",
				"a.cts",
				"a.d.ts",
				"a.tsx",
				"a.js",
				"a.mjs",
				"a.cjs",
				"a.jsx",
				"a.py",
				"a.pyi",
				"a.go",
				"a.rs",
				"A.java",
			].map(detectLang),
		).toEqual([
			"typescript",
			"typescript",
			"typescript",
			"typescript",
			"tsx",
			"javascript",
			"javascript",
			"javascript",
			"javascript",
			"python",
			"python",
			"go",
			"rust",
			"java",
		]);
	});

	test("returns null for files it cannot parse", () => {
		expect(detectLang("README.md")).toBeNull();
		expect(detectLang("Makefile")).toBeNull();
		expect(detectLang("style.css")).toBeNull();
	});
});

describe("isTestPath", () => {
	test("TS/JS: .test/.spec files and __tests__ directories", () => {
		expect(isTestPath("src/a.test.ts", "typescript")).toBe(true);
		expect(isTestPath("src/a.spec.tsx", "tsx")).toBe(true);
		expect(isTestPath("src/__tests__/a.ts", "typescript")).toBe(true);
		expect(isTestPath("src/testing.ts", "typescript")).toBe(false);
	});
});

describe("parseFile", () => {
	test("an explicit language overrides the extension", async () => {
		const result = await parseFile(
			"script",
			"def run():\n    pass\n",
			"python",
		);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(symbolRows(result.value)).toEqual(["function run exported"]);
	});

	test("an unknown extension without a language is an error value, not a throw", async () => {
		const result = await parseFile("notes.md", "# hi");
		expect(result).toEqual({
			ok: false,
			error: { kind: "unsupported_language", path: "notes.md" },
		});
	});

	test("empty and garbage input still produce a result", async () => {
		const empty = await parseFile("empty.ts", "");
		expect(empty.ok).toBe(true);
		if (empty.ok) {
			expect(empty.value.symbols).toEqual([]);
			expect(empty.value.errors).toEqual([]);
		}
		const garbage = await parseFile("junk.rs", "\u0000}}}{{{ fn ((( ::: �");
		expect(garbage.ok).toBe(true);
		if (garbage.ok) expect(garbage.value.errors.length).toBeGreaterThan(0);
	});

	test("pathologically deep nesting keeps what was extracted and reports a limit", async () => {
		const deep = `${"(".repeat(20000)}1${")".repeat(20000)}`;
		const source = `def before():\n    work()\n\nx = ${deep}\n`;
		const result = await parseFile("deep.py", source);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(symbolRows(result.value)).toEqual(["function before exported"]);
		expect(result.value.calls.map((c) => c.callee)).toEqual(["work"]);
		expect(result.value.errors.map((e) => e.kind)).toContain("limit");
	});

	test("reports each syntax error with a location", async () => {
		const result = await parseFile("x.ts", "function f( {\n}\n");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [first] = result.value.errors;
		expect(first?.kind === "error" || first?.kind === "missing").toBe(true);
		expect(first?.span.startLine).toBe(1);
	});

	test("parses languages concurrently without mixing grammars", async () => {
		const results = await Promise.all([
			parseFile("a.go", "package a\nfunc A() {}"),
			parseFile("b.py", "def b():\n    pass"),
			parseFile("c.java", "class C { void c() {} }"),
			parseFile("d.ts", "function d() {}"),
		]);
		expect(results.map((r) => (r.ok ? symbolRows(r.value) : r.error))).toEqual([
			["function A exported"],
			["function b exported"],
			["class C", "method C.c"],
			["function d"],
		]);
	});
});
