import { describe, expect, test } from "bun:test";
import {
	extractPatchDestinations,
	extractPatchFiles,
	validatePatchScope,
} from "../autofix";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 0000000..1111111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
-old line
+new line
`;

const TWO_FILE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
@@ -1 +1 @@
-x
+y
diff --git a/src/bar.ts b/src/bar.ts
@@ -1 +1 @@
-x
+y
`;

const RENAME_DIFF = `diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
`;

describe("extractPatchFiles", () => {
	test("returns the file from a single-file diff", () => {
		expect(extractPatchFiles(SAMPLE_DIFF)).toEqual(["src/foo.ts"]);
	});

	test("collects every file from a multi-file diff", () => {
		expect(extractPatchFiles(TWO_FILE_DIFF).sort()).toEqual([
			"src/bar.ts",
			"src/foo.ts",
		]);
	});

	test("captures both old and new path on a rename", () => {
		expect(extractPatchFiles(RENAME_DIFF).sort()).toEqual([
			"src/new.ts",
			"src/old.ts",
		]);
	});

	test("returns empty array on a non-git diff", () => {
		expect(extractPatchFiles("--- a/foo\n+++ b/foo\n")).toEqual([]);
		expect(extractPatchFiles("not a diff at all")).toEqual([]);
	});
});

describe("extractPatchDestinations", () => {
	test("returns only the destination of a rename", () => {
		expect(extractPatchDestinations(RENAME_DIFF)).toEqual(["src/new.ts"]);
	});

	test("returns the single path for plain edits", () => {
		expect(extractPatchDestinations(SAMPLE_DIFF)).toEqual(["src/foo.ts"]);
	});

	test("handles CRLF line endings", () => {
		const crlf = SAMPLE_DIFF.replace(/\n/g, "\r\n");
		expect(extractPatchDestinations(crlf)).toEqual(["src/foo.ts"]);
	});
});

describe("validatePatchScope", () => {
	test("accepts a rename when only the destination is in the allowlist", () => {
		const result = validatePatchScope(
			{ diff: RENAME_DIFF, rationale: "rename" },
			["src/new.ts"],
		);
		expect(result.ok).toBe(true);
		// touchedFiles still includes the source so callers can stage the deletion
		if (result.ok) {
			expect(result.touchedFiles.sort()).toEqual(["src/new.ts", "src/old.ts"]);
		}
	});

	test("handles CRLF-encoded diffs without polluting paths with \\r", () => {
		const crlf = SAMPLE_DIFF.replace(/\n/g, "\r\n");
		const result = validatePatchScope({ diff: crlf, rationale: "x" }, [
			"src/foo.ts",
		]);
		expect(result.ok).toBe(true);
	});

	test("ok when every touched file is allowed", () => {
		const result = validatePatchScope({ diff: SAMPLE_DIFF, rationale: "fix" }, [
			"src/foo.ts",
			"src/bar.ts",
		]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.touchedFiles).toEqual(["src/foo.ts"]);
	});

	test("rejects when patch touches an out-of-scope file", () => {
		const result = validatePatchScope(
			{ diff: TWO_FILE_DIFF, rationale: "fix" },
			["src/foo.ts"],
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("out-of-scope");
			expect(result.details?.offending).toEqual(["src/bar.ts"]);
		}
	});

	test("rejects an empty patch", () => {
		const result = validatePatchScope({ diff: "", rationale: "noop" }, [
			"src/foo.ts",
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("empty-diff");
	});

	test("rejects undefined / missing patch", () => {
		const result = validatePatchScope(undefined, ["src/foo.ts"]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("empty-diff");
	});

	test("rejects a malformed diff with no git headers", () => {
		const result = validatePatchScope(
			{ diff: "--- a/foo\n+++ b/foo\n", rationale: "x" },
			["foo"],
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("malformed-diff");
	});

	test("strips ./ prefix when comparing scope", () => {
		const diff = `diff --git a/./src/foo.ts b/./src/foo.ts
@@ -1 +1 @@
-x
+y
`;
		const result = validatePatchScope({ diff, rationale: "x" }, ["src/foo.ts"]);
		expect(result.ok).toBe(true);
	});
});
