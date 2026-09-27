import { describe, expect, test } from "bun:test";
import { type DecidePorts, defaultDecidePorts } from "../../decide/decide";
import { createRegistry, DEFAULT_REGISTRY } from "../../decide/registry";
import type { Backend, BackendCalibration } from "../../decide/types";
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

	test("a calibrated system1 answer is judged against its calibrated threshold (#576)", () => {
		// Delegates to the heuristic, so the answer (0.75 not covered) is the
		// same; only the backend that answered, and its calibration, differ.
		const system1With = (calibration: BackendCalibration): DecidePorts => {
			const heuristic = DEFAULT_REGISTRY.get("heuristic");
			if (heuristic === undefined) throw new Error("no heuristic backend");
			const system1: Backend = {
				...heuristic,
				id: "system1",
				version: "test-1",
				calibration,
			};
			const policy: Policy = {
				...DEFAULT_POLICY,
				decisions: {
					...DEFAULT_POLICY.decisions,
					"spec.coverage": {
						...DEFAULT_POLICY.decisions["spec.coverage"],
						backend: "system1",
					},
				},
			};
			return {
				...defaultDecidePorts,
				policy,
				backends: createRegistry([...DEFAULT_REGISTRY.values(), system1]),
			};
		};
		const coverageOf = (ports: DecidePorts) =>
			analyzeArtifacts(SPEC, PLAN, TASKS, ports).findings.find(
				(f) => f.category === "spec-coverage",
			);
		const lenient = coverageOf(
			system1With({
				sha256: "a".repeat(64),
				thresholds: { "spec.coverage": { confidence: 0.7 } },
			}),
		);
		expect(lenient?.threshold).toBe(0.7);
		expect(lenient?.severity).toBe("error");
		expect(lenient?.blocking).toBe(true);

		const never = coverageOf(
			system1With({
				sha256: "b".repeat(64),
				thresholds: { "spec.coverage": { confidence: null } },
			}),
		);
		expect(never?.severity).toBe("warning");
		expect(never?.blocking).toBe(false);
	});

	test("an escalated system1 answer is not acted on: its finding does not block (#577)", () => {
		// The heuristic's answer (0.75 not covered), with an escalate signal:
		// spec.coverage costs FP 1, FN 1, so the cutoff is 0.5.
		const withEscalate = (escalate: number): DecidePorts => {
			const heuristic = DEFAULT_REGISTRY.get("heuristic");
			if (heuristic === undefined) throw new Error("no heuristic backend");
			const system1: Backend = {
				id: "system1",
				version: "test-1",
				answer: (input) => {
					const answered = heuristic.answer(input);
					return answered.ok
						? {
								ok: true,
								value: answered.value.map((a) => ({
									...a,
									diagnostics: { escalate },
								})),
							}
						: answered;
				},
			};
			// A policy threshold of 0.7 would act on the 0.75 answer.
			const policy: Policy = {
				...DEFAULT_POLICY,
				decisions: {
					...DEFAULT_POLICY.decisions,
					"spec.coverage": {
						...DEFAULT_POLICY.decisions["spec.coverage"],
						backend: "system1",
						thresholds: { confidence: 0.7 },
					},
				},
			};
			return {
				...defaultDecidePorts,
				policy,
				backends: createRegistry([...DEFAULT_REGISTRY.values(), system1]),
			};
		};
		const coverageOf = (ports: DecidePorts) =>
			analyzeArtifacts(SPEC, PLAN, TASKS, ports).findings.find(
				(f) => f.category === "spec-coverage",
			);
		const calm = coverageOf(withEscalate(0.1));
		expect(calm?.severity).toBe("error");
		expect(calm?.blocking).toBe(true);

		const escalated = coverageOf(withEscalate(0.9));
		expect(escalated?.confidence).toBeCloseTo(0.75, 5);
		expect(escalated?.severity).toBe("warning");
		expect(escalated?.blocking).toBe(false);
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
