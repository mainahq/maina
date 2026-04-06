import { describe, expect, test } from "bun:test";
import type {
	DetectedTool,
	Finding,
	PipelineOptions,
	PipelineResult,
	ToolReport,
} from "../types";

// ─── Verify Type Exports ────────────────────────────────────────────────────

describe("verify/types re-exports", () => {
	test("Finding type has expected shape", () => {
		const finding: Finding = {
			tool: "semgrep",
			file: "src/index.ts",
			line: 42,
			message: "unused variable",
			severity: "warning",
		};
		expect(finding.tool).toBe("semgrep");
		expect(finding.file).toBe("src/index.ts");
		expect(finding.line).toBe(42);
		expect(finding.message).toBe("unused variable");
		expect(finding.severity).toBe("warning");
	});

	test("Finding type supports optional fields", () => {
		const finding: Finding = {
			tool: "eslint",
			file: "app.ts",
			line: 10,
			column: 5,
			message: "no-unused-vars",
			severity: "error",
			ruleId: "no-unused-vars",
		};
		expect(finding.column).toBe(5);
		expect(finding.ruleId).toBe("no-unused-vars");
	});

	test("ToolReport type has expected shape", () => {
		const report: ToolReport = {
			tool: "trivy",
			findings: [],
			skipped: false,
			duration: 123,
		};
		expect(report.tool).toBe("trivy");
		expect(report.findings).toEqual([]);
		expect(report.skipped).toBe(false);
		expect(report.duration).toBe(123);
	});

	test("PipelineResult type has expected shape", () => {
		const result: PipelineResult = {
			passed: true,
			syntaxPassed: true,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 500,
			cacheHits: 2,
			cacheMisses: 1,
		};
		expect(result.passed).toBe(true);
		expect(result.syntaxPassed).toBe(true);
		expect(result.tools).toEqual([]);
		expect(result.findings).toEqual([]);
		expect(result.hiddenCount).toBe(0);
		expect(result.detectedTools).toEqual([]);
		expect(result.duration).toBe(500);
		expect(result.cacheHits).toBe(2);
		expect(result.cacheMisses).toBe(1);
	});

	test("PipelineOptions type has expected shape", () => {
		const opts: PipelineOptions = {
			files: ["src/app.ts"],
			baseBranch: "main",
			diffOnly: true,
			deep: false,
			cwd: "/tmp",
			mainaDir: ".maina",
			languages: ["typescript"],
		};
		expect(opts.files).toEqual(["src/app.ts"]);
		expect(opts.baseBranch).toBe("main");
		expect(opts.diffOnly).toBe(true);
		expect(opts.deep).toBe(false);
	});

	test("DetectedTool type has expected shape", () => {
		const tool: DetectedTool = {
			name: "biome",
			command: "biome",
			version: "1.5.0",
			available: true,
		};
		expect(tool.name).toBe("biome");
		expect(tool.command).toBe("biome");
		expect(tool.version).toBe("1.5.0");
		expect(tool.available).toBe(true);
	});

	test("DetectedTool supports null version", () => {
		const tool: DetectedTool = {
			name: "semgrep",
			command: "semgrep",
			version: null,
			available: false,
		};
		expect(tool.version).toBeNull();
		expect(tool.available).toBe(false);
	});
});

// ─── Verify types re-exported from @mainahq/core index ──────────────────────

describe("verify types from core index", () => {
	test("types are importable from core index", async () => {
		const coreIndex = await import("../../index");
		// The module should export these — we verify by checking the module loaded
		// Type-only exports don't appear at runtime, but the module must resolve
		expect(coreIndex).toBeDefined();
		expect(typeof coreIndex.VERSION).toBe("string");
	});
});
