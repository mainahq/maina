/**
 * Tests for the Verify Pipeline Orchestrator.
 *
 * Mocks all individual tool modules to test orchestration logic:
 * ordering (syntax first), parallel execution, diff filtering, pass/fail.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { DetectedTool } from "../detect";
import type { DiffFilterResult, Finding } from "../diff-filter";
import type { SecretlintResult } from "../secretlint";
import type { SemgrepResult } from "../semgrep";
import type { SlopResult } from "../slop";
import type { SyntaxDiagnostic, SyntaxGuardResult } from "../syntax-guard";
import type { TrivyResult } from "../trivy";

// ─── Mock State ────────────────────────────────────────────────────────────

// We use manual mock functions tracked via closures.
// Each test configures the behavior by setting these.

let mockSyntaxGuardResult: SyntaxGuardResult = { ok: true, value: undefined };
let mockDetectedTools: DetectedTool[] = [];
let mockSlopResult: SlopResult = { findings: [], cached: false };
let mockSemgrepResult: SemgrepResult = { findings: [], skipped: false };
let mockTrivyResult: TrivyResult = { findings: [], skipped: false };
let mockSecretlintResult: SecretlintResult = { findings: [], skipped: false };
let mockDiffFilterResult: DiffFilterResult = { shown: [], hidden: 0 };
let mockStagedFiles: string[] = ["src/app.ts"];

// Track call order for verifying pipeline sequencing
let callOrder: string[] = [];

// Mock the modules
mock.module("../syntax-guard", () => ({
	syntaxGuard: async (..._args: unknown[]) => {
		callOrder.push("syntaxGuard");
		return mockSyntaxGuardResult;
	},
}));

mock.module("../detect", () => ({
	detectTools: async () => {
		callOrder.push("detectTools");
		return mockDetectedTools;
	},
}));

mock.module("../slop", () => ({
	detectSlop: async (..._args: unknown[]) => {
		callOrder.push("detectSlop");
		return mockSlopResult;
	},
}));

mock.module("../semgrep", () => ({
	runSemgrep: async (..._args: unknown[]) => {
		callOrder.push("runSemgrep");
		return mockSemgrepResult;
	},
}));

mock.module("../trivy", () => ({
	runTrivy: async (..._args: unknown[]) => {
		callOrder.push("runTrivy");
		return mockTrivyResult;
	},
}));

mock.module("../secretlint", () => ({
	runSecretlint: async (..._args: unknown[]) => {
		callOrder.push("runSecretlint");
		return mockSecretlintResult;
	},
}));

mock.module("../diff-filter", () => ({
	filterByDiff: async (findings: Finding[], ..._args: unknown[]) => {
		callOrder.push("filterByDiff");
		// If a custom result was set, use it; otherwise pass through all findings
		if (
			mockDiffFilterResult.shown.length > 0 ||
			mockDiffFilterResult.hidden > 0
		) {
			return mockDiffFilterResult;
		}
		return { shown: findings, hidden: 0 };
	},
}));

mock.module("../../git/index", () => ({
	getStagedFiles: async (..._args: unknown[]) => {
		callOrder.push("getStagedFiles");
		return mockStagedFiles;
	},
}));

// Import AFTER mocking
import { runPipeline } from "../pipeline";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		tool: "test",
		file: "src/app.ts",
		line: 10,
		message: "test finding",
		severity: "warning",
		...overrides,
	};
}

function makeDetectedTool(name: string, available: boolean): DetectedTool {
	return {
		name,
		command: name,
		version: available ? "1.0.0" : null,
		available,
	};
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("VerifyPipeline", () => {
	beforeEach(() => {
		// Reset all mock state
		callOrder = [];
		mockSyntaxGuardResult = { ok: true, value: undefined };
		mockDetectedTools = [
			makeDetectedTool("biome", true),
			makeDetectedTool("semgrep", true),
			makeDetectedTool("trivy", true),
			makeDetectedTool("secretlint", true),
		];
		mockSlopResult = { findings: [], cached: false };
		mockSemgrepResult = { findings: [], skipped: false };
		mockTrivyResult = { findings: [], skipped: false };
		mockSecretlintResult = { findings: [], skipped: false };
		mockDiffFilterResult = { shown: [], hidden: 0 };
		mockStagedFiles = ["src/app.ts"];
	});

	it("should auto-detect installed tools", async () => {
		mockDetectedTools = [
			makeDetectedTool("biome", true),
			makeDetectedTool("semgrep", true),
			makeDetectedTool("trivy", false),
			makeDetectedTool("secretlint", true),
		];

		const result = await runPipeline({ files: ["src/app.ts"] });

		expect(result.detectedTools).toHaveLength(4);
		expect(
			result.detectedTools.find((t) => t.name === "trivy")?.available,
		).toBe(false);
		expect(
			result.detectedTools.find((t) => t.name === "semgrep")?.available,
		).toBe(true);
	});

	it("should run all detected tools in parallel", async () => {
		const slopFinding = makeFinding({ tool: "slop", message: "slop issue" });
		const semgrepFinding = makeFinding({
			tool: "semgrep",
			message: "semgrep issue",
		});
		const trivyFinding = makeFinding({ tool: "trivy", message: "trivy issue" });

		mockSlopResult = { findings: [slopFinding], cached: false };
		mockSemgrepResult = { findings: [semgrepFinding], skipped: false };
		mockTrivyResult = { findings: [trivyFinding], skipped: false };
		mockSecretlintResult = { findings: [], skipped: false };

		// diff filter passes everything through
		mockDiffFilterResult = {
			shown: [slopFinding, semgrepFinding, trivyFinding],
			hidden: 0,
		};

		const result = await runPipeline({ files: ["src/app.ts"] });

		// All tools should have run
		expect(callOrder).toContain("detectSlop");
		expect(callOrder).toContain("runSemgrep");
		expect(callOrder).toContain("runTrivy");
		expect(callOrder).toContain("runSecretlint");

		// 4 tool reports (slop + semgrep + trivy + secretlint)
		expect(result.tools).toHaveLength(4);
		expect(result.findings).toHaveLength(3);
	});

	it("should skip missing tools with info note", async () => {
		mockDetectedTools = [
			makeDetectedTool("biome", true),
			makeDetectedTool("semgrep", false),
			makeDetectedTool("trivy", false),
			makeDetectedTool("secretlint", false),
		];

		mockSemgrepResult = { findings: [], skipped: true };
		mockTrivyResult = { findings: [], skipped: true };
		mockSecretlintResult = { findings: [], skipped: true };

		const result = await runPipeline({ files: ["src/app.ts"] });

		// Semgrep, trivy, secretlint should be marked as skipped
		const semgrepReport = result.tools.find((t) => t.tool === "semgrep");
		const trivyReport = result.tools.find((t) => t.tool === "trivy");
		const secretlintReport = result.tools.find((t) => t.tool === "secretlint");

		expect(semgrepReport?.skipped).toBe(true);
		expect(trivyReport?.skipped).toBe(true);
		expect(secretlintReport?.skipped).toBe(true);

		// Slop always runs (doesn't depend on external tools)
		const slopReport = result.tools.find((t) => t.tool === "slop");
		expect(slopReport?.skipped).toBe(false);
	});

	it("should apply diff-only filtering by default", async () => {
		const finding1 = makeFinding({
			tool: "slop",
			line: 5,
			message: "on changed line",
		});
		const finding2 = makeFinding({
			tool: "slop",
			line: 50,
			message: "on old line",
		});

		mockSlopResult = { findings: [finding1, finding2], cached: false };
		mockDiffFilterResult = {
			shown: [finding1],
			hidden: 1,
		};

		const result = await runPipeline({ files: ["src/app.ts"] });

		expect(callOrder).toContain("filterByDiff");
		expect(result.findings).toHaveLength(1);
		expect(result.hiddenCount).toBe(1);
	});

	it("should report pre-existing count as hidden", async () => {
		const newFinding = makeFinding({ tool: "slop", message: "new issue" });
		const oldFindings = Array.from({ length: 5 }, (_, i) =>
			makeFinding({ tool: "slop", line: 100 + i, message: `old issue ${i}` }),
		);

		mockSlopResult = { findings: [newFinding, ...oldFindings], cached: false };
		mockDiffFilterResult = {
			shown: [newFinding],
			hidden: 5,
		};

		const result = await runPipeline({ files: ["src/app.ts"] });

		expect(result.hiddenCount).toBe(5);
		expect(result.findings).toHaveLength(1);
	});

	it("should produce unified pass/fail", async () => {
		// No error-severity findings -> pass
		const warningFinding = makeFinding({ severity: "warning" });
		mockSlopResult = { findings: [warningFinding], cached: false };
		mockDiffFilterResult = { shown: [warningFinding], hidden: 0 };

		const passResult = await runPipeline({ files: ["src/app.ts"] });
		expect(passResult.passed).toBe(true);

		// Reset for second assertion
		callOrder = [];

		// Error-severity finding -> fail
		const errorFinding = makeFinding({ severity: "error" });
		mockSlopResult = { findings: [errorFinding], cached: false };
		mockDiffFilterResult = { shown: [errorFinding], hidden: 0 };

		const failResult = await runPipeline({ files: ["src/app.ts"] });
		expect(failResult.passed).toBe(false);
	});

	// ─── Additional orchestration tests ──────────────────────────────────────

	it("should run syntax guard FIRST before any tools", async () => {
		await runPipeline({ files: ["src/app.ts"] });

		// syntaxGuard must be the first call
		expect(callOrder[0]).toBe("syntaxGuard");

		// detectTools should come after syntax guard
		const syntaxIdx = callOrder.indexOf("syntaxGuard");
		const detectIdx = callOrder.indexOf("detectTools");
		expect(syntaxIdx).toBeLessThan(detectIdx);
	});

	it("should abort pipeline if syntax guard fails", async () => {
		const syntaxErrors: SyntaxDiagnostic[] = [
			{
				file: "src/app.ts",
				line: 1,
				column: 1,
				message: "Unexpected token",
				severity: "error",
			},
		];

		mockSyntaxGuardResult = { ok: false, error: syntaxErrors };

		const result = await runPipeline({ files: ["src/app.ts"] });

		expect(result.passed).toBe(false);
		expect(result.syntaxPassed).toBe(false);
		expect(result.syntaxErrors).toEqual(syntaxErrors);

		// No other tools should have run
		expect(callOrder).not.toContain("detectTools");
		expect(callOrder).not.toContain("detectSlop");
		expect(callOrder).not.toContain("runSemgrep");
		expect(result.tools).toHaveLength(0);
	});

	it("should use staged files when no files provided", async () => {
		mockStagedFiles = ["src/staged1.ts", "src/staged2.ts"];

		const result = await runPipeline();

		expect(callOrder).toContain("getStagedFiles");
		expect(result.syntaxPassed).toBe(true);
	});

	it("should skip diff filter when diffOnly is false", async () => {
		const finding = makeFinding({ tool: "slop" });
		mockSlopResult = { findings: [finding], cached: false };

		const result = await runPipeline({
			files: ["src/app.ts"],
			diffOnly: false,
		});

		expect(callOrder).not.toContain("filterByDiff");
		expect(result.findings).toHaveLength(1);
		expect(result.hiddenCount).toBe(0);
	});

	it("should include duration in result", async () => {
		const result = await runPipeline({ files: ["src/app.ts"] });

		expect(typeof result.duration).toBe("number");
		expect(result.duration).toBeGreaterThanOrEqual(0);
	});

	it("should include per-tool durations", async () => {
		const result = await runPipeline({ files: ["src/app.ts"] });

		for (const toolReport of result.tools) {
			expect(typeof toolReport.duration).toBe("number");
			expect(toolReport.duration).toBeGreaterThanOrEqual(0);
		}
	});

	it("should return empty result for empty file list", async () => {
		mockStagedFiles = [];

		const result = await runPipeline();

		expect(result.passed).toBe(true);
		expect(result.syntaxPassed).toBe(true);
		expect(result.findings).toHaveLength(0);
		expect(result.tools).toHaveLength(0);
	});

	it("should pass with only warning and info findings", async () => {
		const warnings = [
			makeFinding({ severity: "warning" }),
			makeFinding({ severity: "info" }),
		];
		mockSlopResult = { findings: warnings, cached: false };
		mockDiffFilterResult = { shown: warnings, hidden: 0 };

		const result = await runPipeline({ files: ["src/app.ts"] });

		expect(result.passed).toBe(true);
	});
});
