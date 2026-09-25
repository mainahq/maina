import { describe, expect, test } from "bun:test";
import { type DecidePorts, defaultDecidePorts } from "../../decide/decide";
import { DEFAULT_POLICY } from "../../policy/defaults";
import type { Policy } from "../../policy/schema";
import { ANALYSIS_CATEGORIES, analyzeArtifacts } from "../analyzer";

function portsWithThreshold(
	type: "spec.coverage" | "spec.contradiction",
	confidence: number,
): DecidePorts {
	const policy: Policy = {
		...DEFAULT_POLICY,
		decisions: {
			...DEFAULT_POLICY.decisions,
			[type]: {
				...DEFAULT_POLICY.decisions[type],
				thresholds: { confidence },
			},
		},
	};
	return { ...defaultDecidePorts, policy };
}

// One criterion, four keywords, one of them in the tasks: not covered, with
// confidence 1 - 1/4 = 0.75 (under the default 0.8 threshold).
const SPEC = `# Feature: Export

## Acceptance criteria
- exports invoices quarterly archive
`;

const PLAN = `# Plan

## Tasks
- T001: Build invoices screen
`;

const TASKS = `# Tasks

## Tasks
- [ ] T001: Build invoices screen
`;

describe("analyzeArtifacts", () => {
	test("reports exactly six categories", () => {
		expect(ANALYSIS_CATEGORIES).toEqual([
			"missing-file",
			"spec-coverage",
			"orphaned-task",
			"separation-violation",
			"task-consistency",
			"contradiction",
		]);
	});

	test("a finding under the policy threshold is downgraded and does not block", () => {
		const report = analyzeArtifacts(SPEC, PLAN, TASKS);
		const coverage = report.findings.find(
			(f) => f.category === "spec-coverage",
		);
		expect(coverage?.confidence).toBeCloseTo(0.75, 5);
		expect(coverage?.threshold).toBe(0.8);
		expect(coverage?.severity).toBe("warning");
		expect(coverage?.blocking).toBe(false);
		expect(report.blocking).toBe(false);
	});

	test("the same finding blocks once the policy threshold is at or under its confidence", () => {
		const report = analyzeArtifacts(
			SPEC,
			PLAN,
			TASKS,
			portsWithThreshold("spec.coverage", 0.7),
		);
		const coverage = report.findings.find(
			(f) => f.category === "spec-coverage",
		);
		expect(coverage?.threshold).toBe(0.7);
		expect(coverage?.severity).toBe("error");
		expect(coverage?.blocking).toBe(true);
		expect(report.blocking).toBe(true);
		expect(report.summary.errors).toBe(1);
	});

	test("a missing spec is certain, keeps its severity and does not block", () => {
		const report = analyzeArtifacts(null, PLAN, TASKS);
		const missing = report.findings.find(
			(f) => f.category === "missing-file" && f.file === "spec.md",
		);
		expect(missing?.confidence).toBe(1);
		expect(missing?.threshold).toBe(0);
		expect(missing?.severity).toBe("warning");
		expect(missing?.blocking).toBe(false);
	});

	test("a certain coverage gap blocks at the default threshold", () => {
		const spec = `# Feature\n\n## Acceptance criteria\n- archives quarterly ledgers\n`;
		const report = analyzeArtifacts(spec, PLAN, TASKS);
		const coverage = report.findings.find(
			(f) => f.category === "spec-coverage",
		);
		expect(coverage?.confidence).toBe(1);
		expect(coverage?.severity).toBe("error");
		expect(coverage?.blocking).toBe(true);
	});

	test("the uncalibrated severity stays beside the calibrated one", () => {
		const report = analyzeArtifacts(SPEC, PLAN, TASKS);
		const coverage = report.findings.find(
			(f) => f.category === "spec-coverage",
		);
		// The uncalibrated severity stays available beside the calibrated one.
		expect(coverage?.baseSeverity).toBe("error");
	});

	test("a missing tasks.md is informational and never blocks", () => {
		const report = analyzeArtifacts(SPEC, PLAN, null);
		const missing = report.findings.find((f) => f.file === "tasks.md");
		expect(missing?.severity).toBe("info");
		expect(missing?.blocking).toBe(false);
	});

	test("warnings never block, whatever their confidence", () => {
		const spec = `# Feature\n\n## Acceptance criteria\n- stores rows in a SQL database\n`;
		const report = analyzeArtifacts(spec, null, null);
		const leak = report.findings.find(
			(f) => f.category === "separation-violation",
		);
		expect(leak?.confidence).toBe(1);
		expect(leak?.severity).toBe("warning");
		expect(leak?.blocking).toBe(false);
	});

	test("when decide fails, findings keep their severity and errors block (fail closed)", () => {
		const broken: DecidePorts = { ...defaultDecidePorts, backends: new Map() };
		const report = analyzeArtifacts(SPEC, PLAN, TASKS, broken);
		const coverage = report.findings.find(
			(f) => f.category === "spec-coverage",
		);
		expect(coverage?.confidence).toBe(0);
		expect(coverage?.severity).toBe("error");
		expect(coverage?.blocking).toBe(true);
		expect(report.blocking).toBe(true);
	});

	test("reads tasks written in the shipped template format", () => {
		const tasks = `# Verification Tasks: Export

## Phases

### Phase 1 — Foundation (P1 only)

- [ ] **T-001** Test (red): exports invoices quarterly archive — covers FR-001
- [x] **T-002** Implement: invoices quarterly archive export
`;
		const report = analyzeArtifacts(SPEC, null, tasks);
		expect(
			report.findings.filter((f) => f.category === "spec-coverage"),
		).toEqual([]);
	});
});
