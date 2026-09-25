import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceFeature } from "../traceability";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const PLAN_WITH_TASKS = `# Implementation Plan

## Tasks

- T001: Implement login with email validation
- T002: Add error messages for failed attempts
- T003: Create session management middleware
`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("traceFeature", () => {
	let tmpDir: string;
	let featureDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("feature with tasks and matching test files are traced", async () => {
		writeFileSync(join(featureDir, "plan.md"), PLAN_WITH_TASKS);

		// Create a test file that references T001
		const testDir = join(tmpDir, "src", "__tests__");
		mkdirSync(testDir, { recursive: true });
		writeFileSync(
			join(testDir, "login.test.ts"),
			`// T001: login tests\nimport { describe } from "bun:test";\n`,
		);

		const result = await traceFeature(featureDir, tmpDir);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const t001 = result.value.tasks.find((t) => t.taskId === "T001");
		expect(t001).toBeDefined();
		expect(t001?.testFile).toContain("login.test.ts");
	});

	test("feature with task in commit message finds commit hash", async () => {
		writeFileSync(join(featureDir, "plan.md"), PLAN_WITH_TASKS);

		// Mock git log by providing a gitLog dependency
		const result = await traceFeature(featureDir, tmpDir, {
			gitLog: async () =>
				"abc1234 feat(core): T001 implement login\ndef5678 fix: typo\n",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const t001 = result.value.tasks.find((t) => t.taskId === "T001");
		expect(t001).toBeDefined();
		expect(t001?.commitHash).toBe("abc1234");

		// T002 has no matching commit
		const t002 = result.value.tasks.find((t) => t.taskId === "T002");
		expect(t002?.commitHash).toBeNull();
	});

	test("feature with missing test file has testFile as null", async () => {
		writeFileSync(join(featureDir, "plan.md"), PLAN_WITH_TASKS);

		const result = await traceFeature(featureDir, tmpDir);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// No test files created, so all testFile should be null
		for (const task of result.value.tasks) {
			expect(task.testFile).toBeNull();
		}
	});

	test("feature with no plan.md returns error Result", async () => {
		// featureDir exists but no plan.md
		const result = await traceFeature(featureDir, tmpDir);

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toContain("plan.md");
	});

	test("coverage counts are correct", async () => {
		writeFileSync(join(featureDir, "plan.md"), PLAN_WITH_TASKS);

		// Create test file for T001
		const testDir = join(tmpDir, "src", "__tests__");
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "login.test.ts"), `// T001: login tests\n`);

		// Create impl file that mentions "login" and "email" (matching T001 keywords)
		const srcDir = join(tmpDir, "src");
		writeFileSync(
			join(srcDir, "login.ts"),
			`// T001: Implement login with email validation\nexport function login() {}\n`,
		);

		const result = await traceFeature(featureDir, tmpDir, {
			gitLog: async () =>
				"abc1234 feat: T001 login\ndef5678 feat: T002 error messages\n",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const { coverage } = result.value;
		expect(coverage.total).toBe(3);
		expect(coverage.withTests).toBe(1); // Only T001 has matching test
		expect(coverage.withCommits).toBe(2); // T001 and T002 have commits
		expect(coverage.withImpl).toBe(1); // T001 has matching impl
	});

	test("non-existent feature directory returns error Result", async () => {
		const result = await traceFeature(join(tmpDir, "nonexistent"), tmpDir);

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toContain("does not exist");
	});

	test("traces tasks written in the shipped tasks template format", async () => {
		writeFileSync(
			join(featureDir, "tasks.md"),
			`# Verification Tasks: Login

## Phases

- [ ] **T-001** Test (red): login validates email — covers FR-001
- [x] **T-002** Implement: email validation
`,
		);
		const testDir = join(tmpDir, "src", "__tests__");
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "login.test.ts"), "// T-001: email\n");

		const result = await traceFeature(featureDir, tmpDir, {
			gitLog: async () => "",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.tasks.map((t) => t.taskId)).toEqual(["T-001", "T-002"]);
		expect(result.value.tasks[0]?.testFile).toContain("login.test.ts");
		expect(result.value.tasks[0]?.description).toBe(
			"Test (red): login validates email — covers FR-001",
		);
	});
});
