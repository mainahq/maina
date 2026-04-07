import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractWorkflowTrace } from "../../extractors/workflow";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-workflow-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(join(tmpDir, "workflow"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Workflow Trace Extractor", () => {
	describe("extractWorkflowTrace", () => {
		it("happy path: should extract steps from workflow markdown", () => {
			writeFileSync(
				join(tmpDir, "workflow", "current.md"),
				[
					"# Workflow: token-refresh",
					"",
					"## brainstorm (2026-04-07T10:00:00.000Z)",
					"Explored auth options with wiki context.",
					"",
					"## plan (2026-04-07T10:30:00.000Z)",
					"Scaffolded feature 001-token-refresh.",
					"",
					"## commit (2026-04-07T12:00:00.000Z)",
					"Committed initial implementation. 10 tools passed.",
				].join("\n"),
			);

			const result = extractWorkflowTrace(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.featureId).toBe("token-refresh");
			expect(result.value.steps).toHaveLength(3);
			expect(result.value.steps[0]?.command).toBe("brainstorm");
			expect(result.value.steps[0]?.timestamp).toBe("2026-04-07T10:00:00.000Z");
			expect(result.value.steps[0]?.summary).toContain("Explored auth");
			expect(result.value.steps[2]?.command).toBe("commit");
		});

		it("should handle workflow with only header", () => {
			writeFileSync(
				join(tmpDir, "workflow", "current.md"),
				"# Workflow: empty-feature\n",
			);

			const result = extractWorkflowTrace(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.featureId).toBe("empty-feature");
			expect(result.value.steps).toHaveLength(0);
		});

		it("should handle multi-line summaries", () => {
			writeFileSync(
				join(tmpDir, "workflow", "current.md"),
				[
					"# Workflow: multi-line",
					"",
					"## verify (2026-04-07T14:00:00.000Z)",
					"Ran verification pipeline.",
					"10 tools passed, 0 findings.",
					"Coverage: 85%.",
				].join("\n"),
			);

			const result = extractWorkflowTrace(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.steps).toHaveLength(1);
			expect(result.value.steps[0]?.summary).toContain("10 tools passed");
			expect(result.value.steps[0]?.summary).toContain("Coverage: 85%");
		});

		it("should return error when no workflow file exists", () => {
			rmSync(join(tmpDir, "workflow", "current.md"), { force: true });

			const result = extractWorkflowTrace(tmpDir);
			expect(result.ok).toBe(false);
		});

		it("should handle workflow without feature name header", () => {
			writeFileSync(
				join(tmpDir, "workflow", "current.md"),
				[
					"# Workflow",
					"",
					"## commit (2026-04-07T12:00:00.000Z)",
					"Quick commit.",
				].join("\n"),
			);

			const result = extractWorkflowTrace(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.featureId).toBe("");
			expect(result.value.steps).toHaveLength(1);
		});

		it("edge case: step without timestamp", () => {
			writeFileSync(
				join(tmpDir, "workflow", "current.md"),
				["# Workflow: no-time", "", "## brainstorm", "No timestamp here."].join(
					"\n",
				),
			);

			const result = extractWorkflowTrace(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.steps).toHaveLength(1);
			expect(result.value.steps[0]?.command).toBe("brainstorm");
			expect(result.value.steps[0]?.timestamp).toBe("");
		});
	});
});
