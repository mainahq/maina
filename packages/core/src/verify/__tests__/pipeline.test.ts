/**
 * Tests for the Verify Pipeline Orchestrator.
 *
 * Mocks all individual tool modules to test orchestration logic:
 * ordering (syntax first), parallel execution, diff filtering, pass/fail.
 */

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_POLICY } from "../../policy/defaults";
import { createFakeProcess } from "../../ports/testing";
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

// Capture the files argument seen by syntaxGuard so we can assert that the
// pipeline filtered ignored paths (#207) before any tool ran.
let capturedSyntaxGuardFiles: string[] | null = null;

// Capture the arguments tools receive so we can assert the pipeline threads
// its explicit root and injected environment through (#290).
let capturedDetectToolsArgs: unknown[] | null = null;
let capturedTypecheckArgs: unknown[] | null = null;
// Options each external runner received, keyed by runner name (#389).
let capturedRunnerOptions: Record<string, Record<string, unknown>> = {};

// Mock the modules
// NOTE: These mocks are intentionally minimal — they only export what pipeline.ts
// needs. Tests MUST be run via `bun run test` (scripts/test-isolated.ts) which
// runs each test file in its own subprocess, preventing mock.module() bleed.
// Running `bun test` directly (single process) will cause cross-file mock leaks.

mock.module("../syntax-guard", () => ({
	syntaxGuard: async (...args: unknown[]) => {
		callOrder.push("syntaxGuard");
		const files = args[0];
		capturedSyntaxGuardFiles = Array.isArray(files) ? [...files] : null;
		return mockSyntaxGuardResult;
	},
}));

mock.module("../detect", () => ({
	detectTools: async (...args: unknown[]) => {
		callOrder.push("detectTools");
		capturedDetectToolsArgs = args;
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
	runSemgrep: async (options: Record<string, unknown>) => {
		callOrder.push("runSemgrep");
		capturedRunnerOptions.runSemgrep = options;
		return mockSemgrepResult;
	},
}));

mock.module("../trivy", () => ({
	runTrivy: async (options: Record<string, unknown>) => {
		callOrder.push("runTrivy");
		capturedRunnerOptions.runTrivy = options;
		return mockTrivyResult;
	},
}));

mock.module("../secretlint", () => ({
	runSecretlint: async (options: Record<string, unknown>) => {
		callOrder.push("runSecretlint");
		capturedRunnerOptions.runSecretlint = options;
		return mockSecretlintResult;
	},
}));

mock.module("../sonar", () => ({
	runSonar: async (options: Record<string, unknown>) => {
		callOrder.push("runSonar");
		capturedRunnerOptions.runSonar = options;
		return { findings: [], skipped: true };
	},
}));

mock.module("../mutation", () => ({
	runMutation: async (options: Record<string, unknown>) => {
		callOrder.push("runMutation");
		capturedRunnerOptions.runMutation = options;
		return { findings: [], skipped: true };
	},
}));

mock.module("../coverage", () => ({
	runCoverage: async (options: Record<string, unknown>) => {
		callOrder.push("runCoverage");
		capturedRunnerOptions.runCoverage = options;
		return { findings: [], skipped: true };
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

// The diff the AI review and the review triage see (#329).
const SMALL_DIFF = "+  some changed code";
let mockDiff = SMALL_DIFF;

mock.module("../../git/index", () => ({
	getStagedFiles: async (..._args: unknown[]) => {
		callOrder.push("getStagedFiles");
		return mockStagedFiles;
	},
	resolveBaseBranch: async (_cwd?: string, preferred?: string) =>
		preferred ?? "main",
	getDiff: async (..._args: unknown[]) => {
		return mockDiff;
	},
}));

// Scope resolution (#328): staged → the staged mock, working tree → its own.
let mockWorkingTreeFiles: string[] = ["src/app.ts"];
let capturedScopeKind: string | null = null;
mock.module("../../git/scope", () => ({
	resolveScopeFiles: async (kind: string) => {
		capturedScopeKind = kind;
		callOrder.push(kind === "staged" ? "getStagedFiles" : "getWorkingTree");
		return kind === "staged" ? mockStagedFiles : mockWorkingTreeFiles;
	},
}));

// Mock AI review
let mockAIReviewResult: {
	findings: Finding[];
	skipped: boolean;
	tier: string;
	duration: number;
} = {
	findings: [],
	skipped: true,
	tier: "mechanical",
	duration: 0,
};

let capturedAIReviewOptions: Record<string, unknown> | null = null;

mock.module("../ai-review", () => ({
	runAIReview: async (options: Record<string, unknown>) => {
		callOrder.push("runAIReview");
		capturedAIReviewOptions = options;
		return mockAIReviewResult;
	},
}));

mock.module("../typecheck", () => ({
	runTypecheck: async (...args: unknown[]) => {
		callOrder.push("runTypecheck");
		capturedTypecheckArgs = args;
		return { findings: [], duration: 0, tool: "tsc", skipped: true };
	},
}));

mock.module("../consistency", () => ({
	checkConsistency: async (..._args: unknown[]) => {
		callOrder.push("checkConsistency");
		return { findings: [], rulesChecked: 0 };
	},
}));

mock.module("../../language/detect", () => ({
	detectLanguages: (..._args: unknown[]) => ["typescript"],
}));

mock.module("../../language/profile", () => ({
	getProfile: (..._args: unknown[]) => ({
		id: "typescript",
		syntaxTool: "biome",
	}),
	// builtin.ts (not mocked) imports isCodeFile from this module (#372)
	isCodeFile: (filePath: string) => /\.(tsx?|jsx?|mjs|cjs)$/i.test(filePath),
}));

// Explicit, throwaway repository root (#290): the pipeline resolves every
// path, including its default `.maina` dir, against this instead of the cwd.
const ROOT = mkdtempSync(join(tmpdir(), "maina-pipeline-"));
// The file most cases name exists, so the in-process checks really run on it
// and a pass is earned (#328).
mkdirSync(join(ROOT, "src"), { recursive: true });
writeFileSync(join(ROOT, "src", "app.ts"), "export const a = 1;\n");

afterAll(() => {
	mock.restore();
	rmSync(ROOT, { recursive: true, force: true });
});

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
		capturedSyntaxGuardFiles = null;
		capturedDetectToolsArgs = null;
		capturedTypecheckArgs = null;
		capturedRunnerOptions = {};
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
		mockWorkingTreeFiles = ["src/app.ts"];
		capturedScopeKind = null;
		mockDiff = SMALL_DIFF;
		capturedAIReviewOptions = null;
		mockAIReviewResult = {
			findings: [],
			skipped: true,
			tier: "mechanical",
			duration: 0,
		};
	});

	it("should auto-detect installed tools", async () => {
		mockDetectedTools = [
			makeDetectedTool("biome", true),
			makeDetectedTool("semgrep", true),
			makeDetectedTool("trivy", false),
			makeDetectedTool("secretlint", true),
		];

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		expect(result.detectedTools).toHaveLength(4);
		expect(
			result.detectedTools.find((t) => t.name === "trivy")?.available,
		).toBe(false);
		expect(
			result.detectedTools.find((t) => t.name === "semgrep")?.available,
		).toBe(true);
	});

	it("filters bundled/minified artifacts before any tool sees them (#207)", async () => {
		// Simulates a GitHub-Action repo where `dist/index.js` is committed.
		// Without filtering, slop runs on a 100KB ncc bundle and produces
		// thousands of false positives — broke `maina verify` on first run.
		await runPipeline({
			cwd: ROOT,
			files: [
				"src/index.ts",
				"dist/index.js",
				"build/output.js",
				"node_modules/foo/index.js",
				"public/app.min.js",
			],
		});

		expect(capturedSyntaxGuardFiles).not.toBeNull();
		expect(capturedSyntaxGuardFiles).toEqual(["src/index.ts"]);
	});

	it("returns the empty-pipeline shape when every input file is ignored (#207)", async () => {
		// All inputs filtered → nothing left to verify. Should short-circuit
		// to the empty-pipeline result rather than crash.
		const result = await runPipeline({
			cwd: ROOT,
			files: ["dist/index.js", "node_modules/foo/index.js"],
		});

		// Nothing was verified, so nothing passed (#328).
		expect(result.status).toBe("skipped");
		expect(result.passed).toBe(false);
		expect(result.findings).toEqual([]);
		expect(result.tools).toEqual([]);
		// syntaxGuard must not have been called — short-circuit before Step 2.
		expect(callOrder).not.toContain("syntaxGuard");
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

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		// All tools should have run
		expect(callOrder).toContain("detectSlop");
		expect(callOrder).toContain("runSemgrep");
		expect(callOrder).toContain("runTrivy");
		expect(callOrder).toContain("runSecretlint");

		// 13 tool reports (slop + doc-claims + semgrep + trivy + secretlint + sonarqube + stryker + diff-cover + typecheck + consistency + builtin + ai-review + wiki-lint)
		expect(result.tools).toHaveLength(13);
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

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

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

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

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

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		expect(result.hiddenCount).toBe(5);
		expect(result.findings).toHaveLength(1);
	});

	it("should produce unified pass/fail", async () => {
		// No error-severity findings -> pass
		const warningFinding = makeFinding({ severity: "warning" });
		mockSlopResult = { findings: [warningFinding], cached: false };
		mockDiffFilterResult = { shown: [warningFinding], hidden: 0 };

		const passResult = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });
		expect(passResult.passed).toBe(true);

		// Reset for second assertion
		callOrder = [];

		// Error-severity finding -> fail
		const errorFinding = makeFinding({ severity: "error" });
		mockSlopResult = { findings: [errorFinding], cached: false };
		mockDiffFilterResult = { shown: [errorFinding], hidden: 0 };

		const failResult = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });
		expect(failResult.passed).toBe(false);
	});

	// ─── Additional orchestration tests ──────────────────────────────────────

	it("should run syntax guard FIRST before any tools", async () => {
		await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

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

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		expect(result.passed).toBe(false);
		expect(result.syntaxPassed).toBe(false);
		expect(result.syntaxErrors).toEqual(syntaxErrors);

		// No other tools should have run
		expect(callOrder).not.toContain("detectTools");
		expect(callOrder).not.toContain("detectSlop");
		expect(callOrder).not.toContain("runSemgrep");
		expect(result.tools).toHaveLength(0);
	});

	it("should use the working tree when no files provided (#328)", async () => {
		mockWorkingTreeFiles = ["src/wip.ts", "src/new.ts"];

		const result = await runPipeline({ cwd: ROOT });

		expect(capturedScopeKind).toBe("working-tree");
		expect(capturedSyntaxGuardFiles).toEqual(["src/wip.ts", "src/new.ts"]);
		expect(result.scope).toEqual({
			kind: "working-tree",
			files: ["src/wip.ts", "src/new.ts"],
		});
		expect(result.syntaxPassed).toBe(true);
	});

	it("should use staged files when scope is staged", async () => {
		mockStagedFiles = ["src/staged1.ts", "src/staged2.ts"];

		const result = await runPipeline({ cwd: ROOT, scope: "staged" });

		expect(callOrder).toContain("getStagedFiles");
		expect(result.scope.kind).toBe("staged");
		expect(result.syntaxPassed).toBe(true);
	});

	it("should skip diff filter when diffOnly is false", async () => {
		const finding = makeFinding({ tool: "slop" });
		mockSlopResult = { findings: [finding], cached: false };

		const result = await runPipeline({
			cwd: ROOT,
			files: ["src/app.ts"],
			diffOnly: false,
		});

		expect(callOrder).not.toContain("filterByDiff");
		// At least the slop finding; wiki-lint may add more from real .maina/wiki/
		expect(result.findings.length).toBeGreaterThanOrEqual(1);
		expect(result.findings.some((f) => f.tool === "slop")).toBe(true);
	});

	it("should include duration in result", async () => {
		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		expect(typeof result.duration).toBe("number");
		expect(result.duration).toBeGreaterThanOrEqual(0);
	});

	it("should include per-tool durations", async () => {
		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		for (const toolReport of result.tools) {
			expect(typeof toolReport.duration).toBe("number");
			expect(toolReport.duration).toBeGreaterThanOrEqual(0);
		}
	});

	it("should skip, not pass, an empty file list", async () => {
		mockWorkingTreeFiles = [];

		const result = await runPipeline({ cwd: ROOT });

		expect(result.status).toBe("skipped");
		expect(result.passed).toBe(false);
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

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		expect(result.passed).toBe(true);
	});

	it("should emit warning finding when all external tools are skipped", async () => {
		mockDetectedTools = [
			makeDetectedTool("biome", true),
			makeDetectedTool("semgrep", false),
			makeDetectedTool("trivy", false),
			makeDetectedTool("secretlint", false),
		];

		mockSemgrepResult = { findings: [], skipped: true };
		mockTrivyResult = { findings: [], skipped: true };
		mockSecretlintResult = { findings: [], skipped: true };

		const result = await runPipeline({
			cwd: ROOT,
			files: ["src/app.ts"],
			diffOnly: false,
		});

		// Should include the pipeline warning about skipped external tools
		const pipelineWarning = result.findings.find(
			(f) => f.tool === "pipeline" && f.severity === "warning",
		);
		expect(pipelineWarning).toBeDefined();
		expect(pipelineWarning?.message).toContain("external");
	});

	it("should not emit warning when at least one external tool ran", async () => {
		mockDetectedTools = [
			makeDetectedTool("biome", true),
			makeDetectedTool("semgrep", true),
			makeDetectedTool("trivy", false),
			makeDetectedTool("secretlint", false),
		];

		mockSemgrepResult = { findings: [], skipped: false };
		mockTrivyResult = { findings: [], skipped: true };
		mockSecretlintResult = { findings: [], skipped: true };

		const result = await runPipeline({
			cwd: ROOT,
			files: ["src/app.ts"],
			diffOnly: false,
		});

		const pipelineWarning = result.findings.find((f) => f.tool === "pipeline");
		expect(pipelineWarning).toBeUndefined();
	});

	it("passes each external runner the command path detection resolved (#389)", async () => {
		const local = (bin: string) => `${ROOT}/node_modules/.bin/${bin}`;
		mockDetectedTools = [
			{
				name: "semgrep",
				command: local("semgrep"),
				version: "1.0.0",
				available: true,
			},
			{
				name: "trivy",
				command: local("trivy"),
				version: "1.0.0",
				available: true,
			},
			{
				name: "secretlint",
				command: local("secretlint"),
				version: "1.0.0",
				available: true,
			},
			{
				name: "sonarqube",
				command: local("sonar-scanner"),
				version: "1.0.0",
				available: true,
			},
			{
				name: "stryker",
				command: local("stryker"),
				version: "1.0.0",
				available: true,
			},
			{
				name: "diff-cover",
				command: local("diff-cover"),
				version: "1.0.0",
				available: true,
			},
		];

		await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		expect(capturedRunnerOptions.runSemgrep?.command).toBe(local("semgrep"));
		expect(capturedRunnerOptions.runTrivy?.command).toBe(local("trivy"));
		expect(capturedRunnerOptions.runSecretlint?.command).toBe(
			local("secretlint"),
		);
		expect(capturedRunnerOptions.runSonar?.command).toBe(
			local("sonar-scanner"),
		);
		expect(capturedRunnerOptions.runMutation?.command).toBe(local("stryker"));
		expect(capturedRunnerOptions.runCoverage?.command).toBe(
			local("diff-cover"),
		);
		expect(capturedRunnerOptions.runSemgrep?.available).toBe(true);
	});

	it("surfaces a runner's spawn-failure notice on its tool report (#389)", async () => {
		const notice = "semgrep was detected but could not be started";
		mockSemgrepResult = { findings: [], skipped: true, notice };

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		const semgrepReport = result.tools.find((t) => t.tool === "semgrep");
		expect(semgrepReport?.skipped).toBe(true);
		expect(semgrepReport?.notice).toBe(notice);
		const trivyReport = result.tools.find((t) => t.tool === "trivy");
		expect(trivyReport?.notice).toBeUndefined();
	});

	it("should run AI review after diff filter and include findings", async () => {
		const aiReviewFinding = makeFinding({
			tool: "ai-review",
			message: "missing null check",
			severity: "warning",
			ruleId: "ai-review/edge-case",
		});

		mockAIReviewResult = {
			findings: [aiReviewFinding],
			skipped: false,
			tier: "mechanical",
			duration: 100,
		};

		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });

		expect(callOrder).toContain("runAIReview");
		// Triaged like every finding: no recorded outcomes → an even split (#329).
		expect(result.findings).toContainEqual({
			...aiReviewFinding,
			realProbability: 0.5,
		});
		const aiReport = result.tools.find((t) => t.tool === "ai-review");
		expect(aiReport).toBeDefined();
		expect(aiReport?.skipped).toBe(false);
	});

	it("should pass deep flag to AI review when specified", async () => {
		await runPipeline({ cwd: ROOT, files: ["src/app.ts"], deep: true });
		expect(callOrder).toContain("runAIReview");
		expect(capturedAIReviewOptions?.deep).toBe(true);
	});

	it("runs no deep review when the triage says the diff needs none (#329)", async () => {
		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });
		expect(capturedAIReviewOptions?.deep).toBe(false);
		expect(result.triage).toMatchObject({ needsReview: false, confidence: 1 });
		expect(result.triage?.decisionId).toMatch(/^needs_review:[0-9a-f]{16}$/);
	});

	it("runs a deep review when the triage says the diff needs one (#329)", async () => {
		mockDiff = [
			"diff --git a/src/auth/login.ts b/src/auth/login.ts",
			"--- a/src/auth/login.ts",
			"+++ b/src/auth/login.ts",
			"@@ -1,0 +1,1 @@",
			"+export const allow = true;",
		].join("\n");
		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });
		expect(result.triage?.needsReview).toBe(true);
		expect(capturedAIReviewOptions?.deep).toBe(true);
	});

	it("runs the deep review when the triage cannot decide (fails closed, #329)", async () => {
		const noBackends = {
			clock: { now: () => 0 },
			policy: DEFAULT_POLICY,
			backends: new Map(),
		};
		const result = await runPipeline({
			cwd: ROOT,
			files: ["src/app.ts"],
			decide: noBackends,
		});
		expect(result.triage).toBeUndefined();
		expect(capturedAIReviewOptions?.deep).toBe(true);
	});

	it("suppresses a finding decide is confident is noise, and drops it from its report (#329)", async () => {
		const mainaDir = join(ROOT, ".maina-noise");
		mkdirSync(mainaDir, { recursive: true });
		writeFileSync(
			join(mainaDir, "preferences.json"),
			JSON.stringify({
				updatedAt: "2026-01-01T00:00:00.000Z",
				rules: {
					"slop/noisy": {
						ruleId: "slop/noisy",
						dismissCount: 9,
						totalCount: 10,
						falsePositiveRate: 0.9,
					},
					"slop/borderline": {
						ruleId: "slop/borderline",
						dismissCount: 6,
						totalCount: 10,
						falsePositiveRate: 0.6,
					},
				},
			}),
		);
		const noisy = makeFinding({ tool: "slop", ruleId: "slop/noisy" });
		const borderline = makeFinding({
			tool: "slop",
			ruleId: "slop/borderline",
			severity: "error",
		});
		mockSlopResult = { findings: [noisy, borderline], cached: false };

		const result = await runPipeline({
			cwd: ROOT,
			mainaDir,
			files: ["src/app.ts"],
		});

		const slopFindings = result.findings.filter((f) => f.tool === "slop");
		expect(slopFindings).toHaveLength(1);
		expect(slopFindings[0]).toMatchObject({
			ruleId: "slop/borderline",
			severity: "warning",
		});
		expect(slopFindings[0]?.realProbability).toBeCloseTo(0.4, 10);
		const report = result.tools.find((t) => t.tool === "slop");
		expect(report?.findings).toEqual(slopFindings);
		// The tool's own result is left as it was.
		expect(borderline.severity).toBe("error");
	});

	it("should pass when AI review is skipped", async () => {
		mockAIReviewResult = {
			findings: [],
			skipped: true,
			tier: "mechanical",
			duration: 0,
		};
		const result = await runPipeline({ cwd: ROOT, files: ["src/app.ts"] });
		// Pipeline passes if no error-severity findings from non-wiki tools
		const nonWikiErrors = result.findings.filter(
			(f) => f.tool !== "wiki-lint" && f.severity === "error",
		);
		expect(nonWikiErrors).toHaveLength(0);
		const aiReport = result.tools.find((t) => t.tool === "ai-review");
		expect(aiReport?.skipped).toBe(true);
	});

	it("should accept languages option", async () => {
		const result = await runPipeline({
			cwd: ROOT,
			files: ["src/app.ts"],
			languages: ["typescript"],
		});
		expect(result.syntaxPassed).toBe(true);
	});

	it("threads the explicit root into tool detection (#290)", async () => {
		await runPipeline({ files: ["src/app.ts"], cwd: "/repo/root" });
		expect(capturedDetectToolsArgs?.[0]).toBe("/repo/root");
	});

	it("passes the injected environment to the type checker (#290)", async () => {
		const env = { PATH: "/usr/bin", MAINA_MARKER: "1" };
		const proc = createFakeProcess();
		await runPipeline({
			files: ["src/app.ts"],
			cwd: "/repo/root",
			env,
			process: proc,
		});
		expect(capturedTypecheckArgs?.[1]).toBe("/repo/root");
		expect(capturedTypecheckArgs?.[2]).toEqual({
			language: "typescript",
			env,
			process: proc,
		});
	});
});
