import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	appendWorkflowStep,
	loadWorkflowContext,
	resetWorkflowContext,
} from "../context";

describe("WorkflowContext", () => {
	const testDir = join(import.meta.dir, "__fixtures__/workflow");
	const mainaDir = join(testDir, ".maina");

	function cleanup() {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	}

	function setup() {
		cleanup();
		mkdirSync(mainaDir, { recursive: true });
	}

	it("should reset workflow context with feature name header", () => {
		setup();
		resetWorkflowContext(mainaDir, "feature/014-workflow-context");

		const content = loadWorkflowContext(mainaDir);
		expect(content).toContain("# Workflow: feature/014-workflow-context");
		cleanup();
	});

	it("should append a workflow step", () => {
		setup();
		resetWorkflowContext(mainaDir, "feature/014-test");
		appendWorkflowStep(
			mainaDir,
			"plan",
			"Feature 014 scaffolded. Branch created.",
		);

		const content = loadWorkflowContext(mainaDir);
		expect(content).toContain("## plan");
		expect(content).toContain("Feature 014 scaffolded");
		cleanup();
	});

	it("should append multiple steps in order", () => {
		setup();
		resetWorkflowContext(mainaDir, "feature/014-test");
		appendWorkflowStep(mainaDir, "plan", "Scaffolded.");
		appendWorkflowStep(mainaDir, "design", "ADR 0004 created.");
		appendWorkflowStep(mainaDir, "commit", "Verified and committed.");

		const content = loadWorkflowContext(mainaDir);
		expect(content).toContain("## plan");
		expect(content).toContain("## design");
		expect(content).toContain("## commit");

		// Steps should appear in order
		const c = content as string;
		const planIdx = c.indexOf("## plan");
		const designIdx = c.indexOf("## design");
		const commitIdx = c.indexOf("## commit");
		expect(planIdx).toBeLessThan(designIdx);
		expect(designIdx).toBeLessThan(commitIdx);
		cleanup();
	});

	it("should return null when no workflow context exists", () => {
		setup();
		const content = loadWorkflowContext(mainaDir);
		expect(content).toBeNull();
		cleanup();
	});

	it("should include timestamp in each step", () => {
		setup();
		resetWorkflowContext(mainaDir, "test");
		appendWorkflowStep(mainaDir, "plan", "Test step.");

		const content = loadWorkflowContext(mainaDir);
		// ISO timestamp pattern
		expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
		cleanup();
	});

	it("should create workflow directory if it doesn't exist", () => {
		cleanup();
		// Don't create mainaDir — the function should handle it
		mkdirSync(testDir, { recursive: true });
		resetWorkflowContext(join(testDir, ".maina"), "test");

		expect(existsSync(join(testDir, ".maina", "workflow", "current.md"))).toBe(
			true,
		);
		cleanup();
	});

	it("should overwrite previous workflow on reset", () => {
		setup();
		resetWorkflowContext(mainaDir, "old-feature");
		appendWorkflowStep(mainaDir, "plan", "Old stuff.");
		resetWorkflowContext(mainaDir, "new-feature");

		const content = loadWorkflowContext(mainaDir);
		expect(content).toContain("new-feature");
		expect(content).not.toContain("Old stuff");
		cleanup();
	});
});
