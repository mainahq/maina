import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getContextDb } from "../../db/index";
import { compressReview, storeCompressedReview } from "../compress";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-compress-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("compressReview", () => {
	test("returns compressed string for accepted review", () => {
		const result = compressReview({
			diff: `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
 import { foo } from './foo';
+import { bar } from './bar';

-export const x = 1;
+export const x = foo() + bar();
+export const y = 2;`,
			aiOutput: `## Review Summary
Found 2 issues in the changes:
1. Warning: Missing error handling in foo() call
2. Issue: Variable 'y' is exported but never tested

Overall: Acceptable with minor improvements suggested.`,
			task: "review",
			accepted: true,
		});

		expect(result).not.toBeNull();
		expect(typeof result).toBe("string");
		expect(result?.length).toBeGreaterThan(0);
	});

	test("returns null for rejected review", () => {
		const result = compressReview({
			diff: "some diff",
			aiOutput: "some output",
			task: "review",
			accepted: false,
		});

		expect(result).toBeNull();
	});

	test("compressed output is under 2000 characters (approx 500 tokens)", () => {
		// Create a large diff and review output
		const longDiff = Array(100)
			.fill(null)
			.map(
				(_, i) => `--- a/src/file${i}.ts
+++ b/src/file${i}.ts
@@ -1,3 +1,5 @@
 import { something } from './something';
+import { newThing } from './new-thing';

-export const old = 1;
+export const updated = newThing();
+export const extra = 2;`,
			)
			.join("\n");

		const longAiOutput = Array(50)
			.fill(null)
			.map(
				(_, i) =>
					`${i + 1}. Warning: issue found in file${i}.ts — missing error handling for edge case where input is null. This could lead to runtime errors in production. Fix: add null check before calling the function.`,
			)
			.join("\n");

		const result = compressReview({
			diff: longDiff,
			aiOutput: longAiOutput,
			task: "review",
			accepted: true,
		});

		expect(result).not.toBeNull();
		expect(result?.length).toBeLessThanOrEqual(2000);
	});

	test("extracts file names from diff headers", () => {
		const result = compressReview({
			diff: `--- a/packages/core/src/ai/index.ts
+++ b/packages/core/src/ai/index.ts
@@ -1,3 +1,5 @@
+import { bar } from './bar';
--- a/packages/cli/src/commands/verify.ts
+++ b/packages/cli/src/commands/verify.ts
@@ -10,3 +10,5 @@
+const x = 1;`,
			aiOutput: `Review found no critical issues.
Minor warning: consider adding type annotations.`,
			task: "review",
			accepted: true,
		});

		expect(result).not.toBeNull();
		expect(result).toContain("packages/core/src/ai/index.ts");
		expect(result).toContain("packages/cli/src/commands/verify.ts");
	});
});

describe("storeCompressedReview", () => {
	test("writes compressed review to episodic DB", () => {
		const compressed =
			"[review] Files: src/index.ts | Findings: missing error handling | Verdict: accepted";

		storeCompressedReview(tmpDir, compressed, "review");

		// Verify entry exists in episodic_entries
		const dbResult = getContextDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query(
				"SELECT * FROM episodic_entries WHERE type = 'review' ORDER BY created_at DESC",
			)
			.all() as Array<{
			content: string;
			summary: string;
			type: string;
		}>;

		expect(rows.length).toBe(1);
		expect(rows[0]?.content).toBe(compressed);
		expect(rows[0]?.summary).toBe("Accepted review review");
		expect(rows[0]?.type).toBe("review");
	});
});
