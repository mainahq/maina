/**
 * Tests for post-workflow RL trace analysis.
 *
 * Verifies that analyzeWorkflowTrace() reads workflow context,
 * correlates with feedback data, and generates prompt improvements.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("analyzeWorkflowTrace", () => {
	let mainaDir: string;

	beforeEach(() => {
		mainaDir = join(tmpdir(), `maina-trace-test-${Date.now()}`);
		mkdirSync(join(mainaDir, "workflow"), { recursive: true });
		mkdirSync(join(mainaDir, "prompts"), { recursive: true });
	});

	afterEach(() => {
		rmSync(mainaDir, { recursive: true, force: true });
	});

	it("should parse workflow context into trace steps", async () => {
		writeFileSync(
			join(mainaDir, "workflow", "current.md"),
			[
				"# Workflow: feature/test",
				"",
				"## plan (2026-04-05T10:00:00.000Z)",
				"Feature scaffolded.",
				"",
				"## commit (2026-04-05T10:05:00.000Z)",
				"Verified: 8 tools, 0 findings. Committed.",
			].join("\n"),
		);

		const { analyzeWorkflowTrace } = await import("../trace-analysis");
		const result = await analyzeWorkflowTrace(mainaDir);

		expect(result.steps).toHaveLength(2);
		expect(result.steps[0]?.command).toBe("plan");
		expect(result.steps[1]?.command).toBe("commit");
	});

	it("should return empty improvements when no workflow exists", async () => {
		rmSync(join(mainaDir, "workflow"), { recursive: true, force: true });

		const { analyzeWorkflowTrace } = await import("../trace-analysis");
		const result = await analyzeWorkflowTrace(mainaDir);

		expect(result.steps).toEqual([]);
		expect(result.improvements).toEqual([]);
	});

	it("should generate improvements from trace patterns", async () => {
		writeFileSync(
			join(mainaDir, "workflow", "current.md"),
			[
				"# Workflow: feature/test",
				"",
				"## commit (2026-04-05T10:00:00.000Z)",
				"Verified: 8 tools, 2 findings. Committed.",
				"",
				"## commit (2026-04-05T10:05:00.000Z)",
				"Verified: 8 tools, 3 findings. Committed.",
				"",
				"## commit (2026-04-05T10:10:00.000Z)",
				"Verified: 8 tools, 0 findings. Committed.",
			].join("\n"),
		);

		const { analyzeWorkflowTrace } = await import("../trace-analysis");
		const result = await analyzeWorkflowTrace(mainaDir);

		expect(result.steps).toHaveLength(3);
		// Should detect that early commits had findings, suggesting improvement
		expect(typeof result.summary).toBe("string");
	});

	it("should return TraceResult with correct shape", async () => {
		writeFileSync(
			join(mainaDir, "workflow", "current.md"),
			"# Workflow: test\n",
		);

		const { analyzeWorkflowTrace } = await import("../trace-analysis");
		const result = await analyzeWorkflowTrace(mainaDir);

		expect(result).toHaveProperty("steps");
		expect(result).toHaveProperty("improvements");
		expect(result).toHaveProperty("summary");
		expect(Array.isArray(result.steps)).toBe(true);
		expect(Array.isArray(result.improvements)).toBe(true);
	});
});
