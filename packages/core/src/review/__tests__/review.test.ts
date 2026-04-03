import { describe, expect, test } from "bun:test";
import {
	reviewCodeQuality,
	reviewSpecCompliance,
	runTwoStageReview,
} from "../index";

// ── reviewSpecCompliance ────────────────────────────────────────────────────

describe("reviewSpecCompliance", () => {
	test("no plan → passed", () => {
		const result = reviewSpecCompliance("+ some code change", null);

		expect(result.stage).toBe("spec-compliance");
		expect(result.passed).toBe(true);
		expect(result.findings).toHaveLength(0);
	});

	test("plan with tasks, diff covers all → passed", () => {
		const plan = `## Tasks
- [ ] Add user authentication to auth.ts
- [ ] Update database schema in db/schema.ts`;

		const diff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+export function authenticate() { return true; }
diff --git a/src/db/schema.ts b/src/db/schema.ts
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -1,3 +1,5 @@
+export const usersTable = {};`;

		const result = reviewSpecCompliance(diff, plan);

		expect(result.stage).toBe("spec-compliance");
		expect(result.passed).toBe(true);
		expect(result.findings).toHaveLength(0);
	});

	test("plan with task not in diff → warning (missing implementation)", () => {
		const plan = `## Tasks
- [ ] Add user authentication to auth.ts
- [ ] Update database schema in db/schema.ts`;

		// Only touches auth.ts, not db/schema.ts
		const diff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+export function authenticate() { return true; }`;

		const result = reviewSpecCompliance(diff, plan);

		expect(result.stage).toBe("spec-compliance");
		expect(result.passed).toBe(false);
		expect(result.findings.length).toBeGreaterThan(0);

		const missing = result.findings.find((f) =>
			f.message.toLowerCase().includes("missing"),
		);
		expect(missing).toBeDefined();
		expect(missing?.severity).toBe("warning");
	});

	test("diff changes not in plan → info (over-building)", () => {
		const plan = `## Tasks
- [ ] Add user authentication to auth.ts`;

		// Touches auth.ts (in plan) AND unrelated.ts (not in plan)
		const diff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+export function authenticate() { return true; }
diff --git a/src/unrelated.ts b/src/unrelated.ts
--- a/src/unrelated.ts
+++ b/src/unrelated.ts
@@ -1,3 +1,5 @@
+export function unrelated() {}`;

		const result = reviewSpecCompliance(diff, plan);

		const overBuilding = result.findings.find((f) =>
			f.message.toLowerCase().includes("over-building"),
		);
		expect(overBuilding).toBeDefined();
		expect(overBuilding?.severity).toBe("info");
	});
});

// ── reviewCodeQuality ───────────────────────────────────────────────────────

describe("reviewCodeQuality", () => {
	test("clean diff → passed", () => {
		const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+export function greet(name: string): string {
+  return name;
+}`;

		const result = reviewCodeQuality(diff, null);

		expect(result.stage).toBe("code-quality");
		expect(result.passed).toBe(true);
		expect(result.findings).toHaveLength(0);
	});

	test("diff with console.log → finding", () => {
		const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+export function greet(name: string): string {
+  console.log("hello");
+  return name;
+}`;

		const result = reviewCodeQuality(diff, null);

		expect(result.passed).toBe(false);
		const consoleFinding = result.findings.find((f) =>
			f.message.toLowerCase().includes("console.log"),
		);
		expect(consoleFinding).toBeDefined();
		expect(consoleFinding?.severity).toBe("warning");
	});

	test("diff with TODO no ticket → finding", () => {
		const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+// TODO fix this later
+export function greet() { return "hi"; }`;

		const result = reviewCodeQuality(diff, null);

		expect(result.passed).toBe(false);
		const todoFinding = result.findings.find((f) =>
			f.message.toLowerCase().includes("todo"),
		);
		expect(todoFinding).toBeDefined();
		expect(todoFinding?.severity).toBe("warning");
	});

	test("diff with empty function body → finding", () => {
		const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+export function greet() {}`;

		const result = reviewCodeQuality(diff, null);

		expect(result.passed).toBe(false);
		const emptyFinding = result.findings.find((f) =>
			f.message.toLowerCase().includes("empty"),
		);
		expect(emptyFinding).toBeDefined();
		expect(emptyFinding?.severity).toBe("warning");
	});

	test("diff with very long line → finding", () => {
		const longLine = `+export const x = "${"a".repeat(130)}";`;
		const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
${longLine}`;

		const result = reviewCodeQuality(diff, null);

		const longFinding = result.findings.find((f) =>
			f.message.toLowerCase().includes("long"),
		);
		expect(longFinding).toBeDefined();
		expect(longFinding?.severity).toBe("info");
	});

	test("TODO with ticket reference is allowed", () => {
		const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+// TODO(#123) fix this later
+export function greet() { return "hi"; }`;

		const result = reviewCodeQuality(diff, null);

		const todoFinding = result.findings.find((f) =>
			f.message.toLowerCase().includes("todo"),
		);
		expect(todoFinding).toBeUndefined();
	});
});

// ── runTwoStageReview ───────────────────────────────────────────────────────

describe("runTwoStageReview", () => {
	test("both pass → passed", async () => {
		const diff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+export function authenticate() { return true; }`;

		const plan = `## Tasks
- [ ] Add user authentication to auth.ts`;

		const result = await runTwoStageReview({
			diff,
			planContent: plan,
		});

		expect(result.passed).toBe(true);
		expect(result.stage1.passed).toBe(true);
		expect(result.stage2).not.toBeNull();
		expect(result.stage2?.passed).toBe(true);
	});

	test("stage 1 fails → stage 2 is null", async () => {
		const plan = `## Tasks
- [ ] Add user authentication to auth.ts
- [ ] Update database schema in db/schema.ts`;

		// Only touches unrelated file
		const diff = `diff --git a/src/unrelated.ts b/src/unrelated.ts
--- a/src/unrelated.ts
+++ b/src/unrelated.ts
@@ -1,3 +1,5 @@
+export function unrelated() { return true; }`;

		const result = await runTwoStageReview({
			diff,
			planContent: plan,
		});

		expect(result.passed).toBe(false);
		expect(result.stage1.passed).toBe(false);
		expect(result.stage2).toBeNull();
	});

	test("stage 1 passes but stage 2 fails → passed is false", async () => {
		const diff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+export function authenticate() {
+  console.log("authenticating");
+  return true;
+}`;

		const plan = `## Tasks
- [ ] Add user authentication to auth.ts`;

		const result = await runTwoStageReview({
			diff,
			planContent: plan,
		});

		expect(result.passed).toBe(false);
		expect(result.stage1.passed).toBe(true);
		expect(result.stage2).not.toBeNull();
		expect(result.stage2?.passed).toBe(false);
	});

	test("no plan → stage 1 passes automatically", async () => {
		const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+export function greet(name: string): string {
+  return name;
+}`;

		const result = await runTwoStageReview({
			diff,
			planContent: null,
		});

		expect(result.stage1.passed).toBe(true);
		expect(result.stage2).not.toBeNull();
	});
});
