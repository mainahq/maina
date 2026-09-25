import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveChecksAndStatus } from "../../receipt/build";
import type { PipelineResult } from "../../verify/pipeline";
import {
	converge,
	convergeArtifacts,
	convergeCheck,
	GAP_TYPES,
} from "../converge";

const SPEC = `# Verification Specification: Export

## Requirements *(mandatory)*

- **FR-001**: System MUST export invoices as CSV
- **FR-002**: System MUST email the export link
- **FR-003**: System MUST keep exports for seven days

## Success criteria *(mandatory)*

- **SC-001**: p95 export time under 30 s

## Out of scope

- Scheduled recurring exports every night
`;

const TASKS = `# Verification Tasks: Export

## Phases

- [x] **T-001** Test (red): CSV export — covers FR-001
- [x] **T-002** Implement: CSV export — covers FR-001
- [x] **T-003** Test (red): email link — covers FR-002
- [ ] **T-004** Implement: email link — covers FR-002
- [x] **T-005** Benchmark export latency — covers SC-001
- [ ] **T-006** Add audit trail — covers FR-009
- [ ] **T-007** Implement scheduled recurring exports every night
`;

describe("convergeArtifacts", () => {
	test("gap types are missing, partial, contradicts and unrequested", () => {
		expect(GAP_TYPES).toEqual([
			"missing",
			"partial",
			"contradicts",
			"unrequested",
		]);
	});

	test("classifies every gap between the spec and the tasks", () => {
		const report = convergeArtifacts(SPEC, TASKS);
		expect(report.requirements).toBe(4);
		expect(report.converged).toBe(false);
		expect(report.gaps.map((g) => [g.type, g.subject])).toEqual([
			["missing", "FR-003"],
			["partial", "FR-002"],
			["contradicts", "T-007"],
			["unrequested", "T-006"],
		]);
	});

	test("a requirement is converged when every citing task is done", () => {
		const report = convergeArtifacts(SPEC, TASKS);
		const subjects = report.gaps.map((g) => g.subject);
		expect(subjects).not.toContain("FR-001");
		expect(subjects).not.toContain("SC-001");
	});

	test("a fully delivered spec converges", () => {
		const spec = "## Requirements\n\n- **FR-001**: System MUST export CSV\n";
		const tasks = "## Phases\n\n- [x] **T-001** Export CSV — covers FR-001\n";
		const report = convergeArtifacts(spec, tasks);
		expect(report.gaps).toEqual([]);
		expect(report.converged).toBe(true);
	});
});

describe("convergeCheck", () => {
	test("records the gaps as a receipt check, one finding per gap", () => {
		const report = { feature: "001-export", ...convergeArtifacts(SPEC, TASKS) };
		const check = convergeCheck(report);
		expect(check.id).toBe("converge-check");
		expect(check.tool).toBe("review-spec");
		expect(check.status).toBe("failed");
		expect(check.findings.map((f) => f.rule)).toEqual([
			"converge/missing",
			"converge/partial",
			"converge/contradicts",
			"converge/unrequested",
		]);
		expect(check.findings[0]?.file).toBe(".maina/features/001-export/spec.md");
		expect(check.findings[0]?.severity).toBe("error");
		expect(check.findings[3]?.file).toBe(".maina/features/001-export/tasks.md");
	});

	test("a converged report is a passed check", () => {
		const check = convergeCheck({
			feature: "001-x",
			requirements: 1,
			gaps: [],
			converged: true,
		});
		expect(check.status).toBe("passed");
		expect(check.findings).toEqual([]);
	});
});

describe("converge", () => {
	let root: string;

	beforeEach(() => {
		root = join(
			tmpdir(),
			`maina-converge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(join(root, ".maina", "features", "001-export"), {
			recursive: true,
		});
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("reads the feature's spec and tasks from the repo", () => {
		const dir = join(root, ".maina", "features", "001-export");
		writeFileSync(join(dir, "spec.md"), SPEC);
		writeFileSync(join(dir, "tasks.md"), TASKS);
		const result = converge(root, "001-export");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.feature).toBe("001-export");
		expect(result.value.gaps).toHaveLength(4);
	});

	test("a feature without spec.md is an error", () => {
		const result = converge(root, "001-export");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("missing_spec");
			expect(result.error.message).toContain("spec.md");
		}
	});

	test("a feature name that escapes the features directory is an error", () => {
		const result = converge(root, "../../etc");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("invalid_feature");
	});
});

describe("convergence on the receipt", () => {
	const pipeline: PipelineResult = {
		passed: true,
		syntaxPassed: true,
		tools: [{ tool: "slop", findings: [], skipped: false, duration: 1 }],
		findings: [],
		hiddenCount: 0,
		detectedTools: [],
		duration: 1,
		cacheHits: 0,
		cacheMisses: 0,
	};

	test("the converge check lands in the receipt checks and fails a passing run", () => {
		const check = convergeCheck({
			feature: "001-export",
			...convergeArtifacts(SPEC, TASKS),
		});
		const { checks, status } = deriveChecksAndStatus(pipeline, 0, [check]);
		expect(checks.map((c) => c.id)).toEqual(["slop-check", "converge-check"]);
		expect(status).toBe("failed");
	});

	test("a passed converge check leaves a passing run passed", () => {
		const check = convergeCheck({
			feature: "001-x",
			requirements: 1,
			gaps: [],
			converged: true,
		});
		expect(deriveChecksAndStatus(pipeline, 0, [check]).status).toBe("passed");
	});
});
