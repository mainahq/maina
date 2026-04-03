import { describe, expect, it } from "bun:test";
import {
	type DiffFilterResult,
	type Finding,
	filterByDiffWithMap,
	parseChangedLines,
} from "../diff-filter";

// ─── parseChangedLines ────────────────────────────────────────────────────

describe("parseChangedLines", () => {
	it("should return empty map for empty diff", () => {
		const result = parseChangedLines("");
		expect(result.size).toBe(0);
	});

	it("should parse single file with added lines", () => {
		const diff = `diff --git a/src/foo.ts b/src/foo.ts
index 1234567..abcdefg 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,6 +10,8 @@
 unchanged line
+added line 1
+added line 2
 unchanged line
 unchanged line
 unchanged line`;

		const result = parseChangedLines(diff);
		expect(result.has("src/foo.ts")).toBe(true);
		const lines = result.get("src/foo.ts") ?? new Set<number>();
		expect(lines.has(11)).toBe(true);
		expect(lines.has(12)).toBe(true);
		// Unchanged lines should NOT be in the set
		expect(lines.has(10)).toBe(false);
		expect(lines.has(13)).toBe(false);
	});

	it("should parse multiple hunks in same file", () => {
		const diff = `diff --git a/src/bar.ts b/src/bar.ts
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -5,3 +5,4 @@
 unchanged
+new line at 6
 unchanged
@@ -20,3 +21,4 @@
 unchanged
+new line at 22
 unchanged`;

		const result = parseChangedLines(diff);
		expect(result.has("src/bar.ts")).toBe(true);
		const lines = result.get("src/bar.ts") ?? new Set<number>();
		expect(lines.has(6)).toBe(true);
		expect(lines.has(22)).toBe(true);
		expect(lines.has(5)).toBe(false);
		expect(lines.has(21)).toBe(false);
	});

	it("should parse multiple files", () => {
		const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line 1
+added at line 2
 line 2
 line 3
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,3 +10,4 @@
 existing
+added at line 11
 existing`;

		const result = parseChangedLines(diff);
		expect(result.size).toBe(2);
		expect(result.get("src/a.ts")?.has(2)).toBe(true);
		expect(result.get("src/b.ts")?.has(11)).toBe(true);
	});

	it("should handle modified lines (shown as deletion + addition)", () => {
		const diff = `diff --git a/src/mod.ts b/src/mod.ts
--- a/src/mod.ts
+++ b/src/mod.ts
@@ -5,4 +5,4 @@
 unchanged
-old line
+new line
 unchanged`;

		const result = parseChangedLines(diff);
		const lines = result.get("src/mod.ts") ?? new Set<number>();
		// The + line is line 6 in the new file
		expect(lines.has(6)).toBe(true);
		// The - line should not produce an entry (it's removed)
		expect(lines.size).toBe(1);
	});

	it("should handle new files (all lines are additions)", () => {
		const diff = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..abcdefg
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3`;

		const result = parseChangedLines(diff);
		expect(result.has("src/new-file.ts")).toBe(true);
		const lines = result.get("src/new-file.ts") ?? new Set<number>();
		expect(lines.has(1)).toBe(true);
		expect(lines.has(2)).toBe(true);
		expect(lines.has(3)).toBe(true);
	});

	it("should skip lines starting with --- and +++", () => {
		// These are file headers, not content lines
		const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 line 1
+added
 line 2
 line 3`;

		const result = parseChangedLines(diff);
		const lines = result.get("src/foo.ts") ?? new Set<number>();
		// Should only contain line 2 (the added line), not metadata
		expect(lines.has(2)).toBe(true);
		expect(lines.size).toBe(1);
	});
});

// ─── filterByDiff ─────────────────────────────────────────────────────────

describe("filterByDiff", () => {
	const sampleFindings: Finding[] = [
		{
			tool: "biome",
			file: "src/foo.ts",
			line: 11,
			message: "Use const instead of let",
			severity: "warning",
			ruleId: "lint/style/useConst",
		},
		{
			tool: "biome",
			file: "src/foo.ts",
			line: 50,
			message: "Unused variable",
			severity: "warning",
			ruleId: "lint/correctness/noUnusedVariables",
		},
		{
			tool: "semgrep",
			file: "src/bar.ts",
			line: 5,
			message: "Potential injection",
			severity: "error",
		},
	];

	it("should show findings on changed lines and hide findings on unchanged lines", () => {
		const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,3 +10,4 @@
 unchanged
+added line
 unchanged`;

		const changedLines = parseChangedLines(diff);
		// src/foo.ts line 11 is changed, line 50 is not
		// src/bar.ts has no changes in this diff

		const result = filterByDiffWithMap(sampleFindings, changedLines);

		expect(result.shown.length).toBe(1);
		expect(result.shown[0]?.file).toBe("src/foo.ts");
		expect(result.shown[0]?.line).toBe(11);
		expect(result.hidden).toBe(2);
	});
});

// ─── VerifyPipeline TDD contract ──────────────────────────────────────────

describe("VerifyPipeline", () => {
	it("should apply diff-only filtering by default", () => {
		const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,5 @@
 existing line
+new import
+new function call
 existing line`;

		const changedLines = parseChangedLines(diff);

		const findings: Finding[] = [
			{
				tool: "biome",
				file: "src/app.ts",
				line: 2,
				message: "New issue on changed line",
				severity: "warning",
			},
			{
				tool: "biome",
				file: "src/app.ts",
				line: 3,
				message: "Another new issue on changed line",
				severity: "error",
			},
			{
				tool: "biome",
				file: "src/app.ts",
				line: 1,
				message: "Pre-existing issue",
				severity: "warning",
			},
		];

		const result = filterByDiffWithMap(findings, changedLines);

		// Changed lines 2 and 3 should be shown
		expect(result.shown.length).toBe(2);
		expect(result.shown.every((f) => [2, 3].includes(f.line))).toBe(true);
		// Unchanged line 1 should be hidden
		expect(result.hidden).toBe(1);
	});

	it("should report pre-existing count as hidden", () => {
		const diff = `diff --git a/src/legacy.ts b/src/legacy.ts
--- a/src/legacy.ts
+++ b/src/legacy.ts
@@ -100,3 +100,4 @@
 old code
+new code
 old code`;

		const changedLines = parseChangedLines(diff);

		const findings: Finding[] = [
			{
				tool: "semgrep",
				file: "src/legacy.ts",
				line: 5,
				message: "Old issue 1",
				severity: "warning",
			},
			{
				tool: "semgrep",
				file: "src/legacy.ts",
				line: 20,
				message: "Old issue 2",
				severity: "error",
			},
			{
				tool: "semgrep",
				file: "src/legacy.ts",
				line: 80,
				message: "Old issue 3",
				severity: "warning",
			},
			{
				tool: "semgrep",
				file: "src/legacy.ts",
				line: 101,
				message: "New issue on changed line",
				severity: "error",
			},
		];

		const result = filterByDiffWithMap(findings, changedLines);

		// 3 pre-existing issues should be hidden
		expect(result.hidden).toBe(3);
		// 1 new issue on changed line should be shown
		expect(result.shown.length).toBe(1);
		expect(result.shown[0]?.line).toBe(101);
	});
});

// ─── Finding type ─────────────────────────────────────────────────────────

describe("Finding type", () => {
	it("should have all required fields", () => {
		const finding: Finding = {
			tool: "biome",
			file: "src/test.ts",
			line: 10,
			message: "Test message",
			severity: "error",
		};

		expect(finding.tool).toBe("biome");
		expect(finding.file).toBe("src/test.ts");
		expect(finding.line).toBe(10);
		expect(finding.message).toBe("Test message");
		expect(finding.severity).toBe("error");
	});

	it("should support optional fields", () => {
		const finding: Finding = {
			tool: "biome",
			file: "src/test.ts",
			line: 10,
			column: 5,
			message: "Test message",
			severity: "warning",
			ruleId: "lint/style/useConst",
		};

		expect(finding.column).toBe(5);
		expect(finding.ruleId).toBe("lint/style/useConst");
	});
});

// ─── DiffFilterResult type ────────────────────────────────────────────────

describe("DiffFilterResult type", () => {
	it("should have shown array and hidden count", () => {
		const result: DiffFilterResult = {
			shown: [],
			hidden: 0,
		};
		expect(Array.isArray(result.shown)).toBe(true);
		expect(typeof result.hidden).toBe("number");
	});
});
