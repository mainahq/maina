import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../analyzer";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-analyzer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const SPEC_CONTENT = `# Feature: User Auth

## User stories
- As a user, I want to log in with email/password

## Acceptance criteria
- Login validates email format
- Failed login shows error message
`;

const PLAN_CONTENT = `# Implementation Plan

## Architecture
- JWT authentication with bcrypt

## Tasks
- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
`;

const TASKS_CONTENT = `# Tasks

- [ ] T001: Implement login with email format validation
- [ ] T002: Add error messages for failed login attempts
`;

describe("analyze", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- Feature dir doesn't exist → error Result ---
	test("non-existent feature dir returns error Result", () => {
		const result = analyze(join(tmpDir, "non-existent"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("does not exist");
		}
	});

	// --- All three files present and consistent → no findings ---
	test("all three consistent files produce no findings", () => {
		writeFileSync(join(tmpDir, "spec.md"), SPEC_CONTENT);
		writeFileSync(join(tmpDir, "plan.md"), PLAN_CONTENT);
		writeFileSync(join(tmpDir, "tasks.md"), TASKS_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.findings).toHaveLength(0);
		expect(result.value.summary.errors).toBe(0);
		expect(result.value.summary.warnings).toBe(0);
		expect(result.value.summary.info).toBe(0);
	});

	// --- Missing spec.md → finding with category "missing-file" ---
	test("missing spec.md produces missing-file finding", () => {
		writeFileSync(join(tmpDir, "plan.md"), PLAN_CONTENT);
		writeFileSync(join(tmpDir, "tasks.md"), TASKS_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const missingFile = result.value.findings.find(
			(f) => f.category === "missing-file" && f.file === "spec.md",
		);
		expect(missingFile).toBeDefined();
		expect(missingFile?.severity).toBe("warning");
	});

	// --- Missing plan.md → finding with category "missing-file" ---
	test("missing plan.md produces missing-file finding", () => {
		writeFileSync(join(tmpDir, "spec.md"), SPEC_CONTENT);
		writeFileSync(join(tmpDir, "tasks.md"), TASKS_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const missingFile = result.value.findings.find(
			(f) => f.category === "missing-file" && f.file === "plan.md",
		);
		expect(missingFile).toBeDefined();
		expect(missingFile?.severity).toBe("warning");
	});

	// --- Missing tasks.md → finding with category "missing-file" ---
	test("missing tasks.md produces missing-file finding", () => {
		writeFileSync(join(tmpDir, "spec.md"), SPEC_CONTENT);
		writeFileSync(join(tmpDir, "plan.md"), PLAN_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const missingFile = result.value.findings.find(
			(f) => f.category === "missing-file" && f.file === "tasks.md",
		);
		expect(missingFile).toBeDefined();
		expect(missingFile?.severity).toBe("info");
	});

	// --- Spec criterion not covered by any task → "spec-coverage" error ---
	test("uncovered spec criterion produces spec-coverage error", () => {
		writeFileSync(
			join(tmpDir, "spec.md"),
			`# Feature: User Auth

## Acceptance criteria
- Login validates email format
- Failed login shows error message
- Password reset sends email within 30 seconds
`,
		);
		writeFileSync(
			join(tmpDir, "plan.md"),
			`# Implementation Plan

## Tasks
- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
`,
		);
		writeFileSync(
			join(tmpDir, "tasks.md"),
			`# Tasks

- [ ] T001: Implement login with email format validation
- [ ] T002: Add error messages for failed login attempts
`,
		);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const coverageFindings = result.value.findings.filter(
			(f) => f.category === "spec-coverage",
		);
		expect(coverageFindings.length).toBeGreaterThan(0);
		expect(coverageFindings[0]?.severity).toBe("error");
		expect(
			coverageFindings.some((f) =>
				f.message.toLowerCase().includes("password reset"),
			),
		).toBe(true);
	});

	// --- Task in plan.md not mapping to spec → "orphaned-task" warning ---
	test("orphaned task in plan.md produces orphaned-task warning", () => {
		writeFileSync(
			join(tmpDir, "spec.md"),
			`# Feature: User Auth

## Acceptance criteria
- Login validates email format
`,
		);
		writeFileSync(
			join(tmpDir, "plan.md"),
			`# Implementation Plan

## Tasks
- T001: Implement login with email format validation
- T002: Set up Kubernetes deployment pipeline
`,
		);
		writeFileSync(
			join(tmpDir, "tasks.md"),
			`# Tasks

- [ ] T001: Implement login with email format validation
- [ ] T002: Set up Kubernetes deployment pipeline
`,
		);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const orphaned = result.value.findings.filter(
			(f) => f.category === "orphaned-task",
		);
		expect(orphaned.length).toBeGreaterThan(0);
		expect(orphaned[0]?.severity).toBe("warning");
		expect(
			orphaned.some((f) => f.message.toLowerCase().includes("kubernetes")),
		).toBe(true);
	});

	// --- spec.md contains implementation keywords → "separation-violation" warning ---
	test("spec.md with implementation keywords produces separation-violation", () => {
		writeFileSync(
			join(tmpDir, "spec.md"),
			`# Feature: User Auth

## Acceptance criteria
- Login validates email format using JWT endpoint
- Failed login shows error message via REST API
`,
		);
		writeFileSync(join(tmpDir, "plan.md"), PLAN_CONTENT);
		writeFileSync(join(tmpDir, "tasks.md"), TASKS_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const violations = result.value.findings.filter(
			(f) => f.category === "separation-violation" && f.file === "spec.md",
		);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0]?.severity).toBe("warning");
	});

	// --- plan.md contains user story language → "separation-violation" warning ---
	test("plan.md with user story language produces separation-violation", () => {
		writeFileSync(join(tmpDir, "spec.md"), SPEC_CONTENT);
		writeFileSync(
			join(tmpDir, "plan.md"),
			`# Implementation Plan

## Architecture
- JWT authentication with bcrypt
- As a user, I want fast login

## Tasks
- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
`,
		);
		writeFileSync(join(tmpDir, "tasks.md"), TASKS_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const violations = result.value.findings.filter(
			(f) => f.category === "separation-violation" && f.file === "plan.md",
		);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0]?.severity).toBe("warning");
	});

	// --- Different task counts between plan.md and tasks.md → "task-consistency" warning ---
	test("different task counts between plan.md and tasks.md produces task-consistency warning", () => {
		writeFileSync(join(tmpDir, "spec.md"), SPEC_CONTENT);
		writeFileSync(
			join(tmpDir, "plan.md"),
			`# Implementation Plan

## Tasks
- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
- T003: Add rate limiting
`,
		);
		writeFileSync(join(tmpDir, "tasks.md"), TASKS_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const consistency = result.value.findings.filter(
			(f) => f.category === "task-consistency",
		);
		expect(consistency.length).toBeGreaterThan(0);
		expect(consistency[0]?.severity).toBe("warning");
		expect(consistency[0]?.message).toContain("3");
		expect(consistency[0]?.message).toContain("2");
	});

	// --- Contradicting task descriptions → "contradiction" warning ---
	test("contradicting task descriptions produce contradiction warning", () => {
		writeFileSync(join(tmpDir, "spec.md"), SPEC_CONTENT);
		writeFileSync(
			join(tmpDir, "plan.md"),
			`# Implementation Plan

## Tasks
- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
`,
		);
		writeFileSync(
			join(tmpDir, "tasks.md"),
			`# Tasks

- [ ] T001: Implement login with email format validation
- [ ] T002: Build notification service for alerts
`,
		);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const contradictions = result.value.findings.filter(
			(f) => f.category === "contradiction",
		);
		expect(contradictions.length).toBeGreaterThan(0);
		expect(contradictions[0]?.severity).toBe("warning");
		expect(contradictions[0]?.message).toContain("T002");
	});

	// --- Summary correctly counts errors/warnings/info ---
	test("summary correctly counts errors, warnings, and info", () => {
		// Missing spec → warning, missing plan → warning, missing tasks → info
		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const { summary } = result.value;
		// 3 missing-file findings: spec (warning), plan (warning), tasks (info)
		expect(summary.warnings).toBe(2);
		expect(summary.info).toBe(1);
		expect(summary.errors).toBe(0);
		expect(summary.errors + summary.warnings + summary.info).toBe(
			result.value.findings.length,
		);
	});

	// --- featureDir is captured in report ---
	test("report includes featureDir", () => {
		writeFileSync(join(tmpDir, "spec.md"), SPEC_CONTENT);
		writeFileSync(join(tmpDir, "plan.md"), PLAN_CONTENT);
		writeFileSync(join(tmpDir, "tasks.md"), TASKS_CONTENT);

		const result = analyze(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.featureDir).toBe(tmpDir);
	});
});
