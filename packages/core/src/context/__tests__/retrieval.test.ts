import { describe, expect, test } from "bun:test";
import type { SearchResult } from "../retrieval";
import { assembleRetrievalText, isToolAvailable, search } from "../retrieval";

describe("isToolAvailable", () => {
	test("returns true for 'git' (always available)", async () => {
		const result = await isToolAvailable("git");
		expect(result).toBe(true);
	});

	test("returns false for 'nonexistent-tool-xyz'", async () => {
		const result = await isToolAvailable("nonexistent-tool-xyz");
		expect(result).toBe(false);
	});
});

describe("search", () => {
	test("finds known symbol in codebase", async () => {
		const results = await search("getCurrentBranch", {
			cwd: process.cwd(),
		});
		expect(results.length).toBeGreaterThan(0);
		// At least one result should contain the search term
		const hasMatch = results.some((r) =>
			r.content.includes("getCurrentBranch"),
		);
		expect(hasMatch).toBe(true);
	});

	test("respects maxResults limit", async () => {
		// Search for something that appears many times (e.g. 'export')
		const results = await search("export", {
			cwd: process.cwd(),
			maxResults: 3,
		});
		expect(results.length).toBeLessThanOrEqual(3);
	});

	test("returns empty array for nonsense query", async () => {
		// Use a pattern that cannot appear in real source code
		const needle = ["ZZZZ", "QQQQ", "NOSUCHSYMBOL", "9999"].join("__");
		const results = await search(needle, {
			cwd: process.cwd(),
		});
		expect(results).toEqual([]);
	});

	test("returns an array (never throws)", async () => {
		// Even with a bad cwd, should not throw
		const results = await search("anything", {
			cwd: "/nonexistent/path/xyz",
		});
		expect(Array.isArray(results)).toBe(true);
	});
});

describe("assembleRetrievalText", () => {
	test("formats results as 'filePath:line: content'", () => {
		const results: SearchResult[] = [
			{
				filePath: "src/foo.ts",
				line: 10,
				content: "export function foo() {}",
				matchLength: 3,
			},
			{
				filePath: "src/bar.ts",
				line: 42,
				content: "const bar = 1;",
				matchLength: 3,
			},
		];
		const text = assembleRetrievalText(results);
		expect(text).toContain("src/foo.ts:10: export function foo() {}");
		expect(text).toContain("src/bar.ts:42: const bar = 1;");
	});

	test("returns empty string for empty results", () => {
		const text = assembleRetrievalText([]);
		expect(text).toBe("");
	});

	test("separates results with newlines", () => {
		const results: SearchResult[] = [
			{ filePath: "a.ts", line: 1, content: "line one", matchLength: 4 },
			{ filePath: "b.ts", line: 2, content: "line two", matchLength: 4 },
		];
		const text = assembleRetrievalText(results);
		const lines = text.split("\n");
		expect(lines.length).toBe(2);
	});
});
