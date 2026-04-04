import { describe, expect, it } from "bun:test";
import { formatVerificationProof, type VerificationProof } from "../proof";

describe("formatVerificationProof", () => {
	const baseProof: VerificationProof = {
		pipeline: [
			{ tool: "slop", findings: 0, duration: 234, skipped: false },
			{ tool: "semgrep", findings: 0, duration: 1200, skipped: false },
			{ tool: "trivy", findings: 0, duration: 3400, skipped: false },
			{ tool: "secretlint", findings: 0, duration: 890, skipped: false },
			{ tool: "sonarqube", findings: 0, duration: 0, skipped: true },
			{ tool: "ai-review", findings: 0, duration: 2100, skipped: false },
		],
		pipelinePassed: true,
		pipelineDuration: 9100,
		tests: { passed: 980, failed: 0, files: 87 },
		review: {
			stage1Passed: true,
			stage1Findings: 0,
			stage2Passed: true,
			stage2Findings: 1,
		},
		slop: { findings: 0 },
		visual: { pages: 2, regressions: 0 },
		workflowSummary: "# Workflow: feature/018\n\n## plan\nScaffolded.",
	};

	it("should include pipeline section with tool table", () => {
		const md = formatVerificationProof(baseProof);
		expect(md).toContain("## Verification Proof");
		expect(md).toContain("Pipeline:");
		expect(md).toContain("| slop |");
		expect(md).toContain("| semgrep |");
		expect(md).toContain("skipped");
	});

	it("should include test results", () => {
		const md = formatVerificationProof(baseProof);
		expect(md).toContain("Tests: 980 pass, 0 fail");
	});

	it("should include code review results", () => {
		const md = formatVerificationProof(baseProof);
		expect(md).toContain("Code Review");
		expect(md).toContain("spec compliance");
		expect(md).toContain("code quality");
	});

	it("should include slop results", () => {
		const md = formatVerificationProof(baseProof);
		expect(md).toContain("Slop: clean");
	});

	it("should include visual results", () => {
		const md = formatVerificationProof(baseProof);
		expect(md).toContain("Visual: 2 page(s)");
	});

	it("should include workflow context", () => {
		const md = formatVerificationProof(baseProof);
		expect(md).toContain("Workflow Context");
		expect(md).toContain("feature/018");
	});

	it("should use collapsible details tags", () => {
		const md = formatVerificationProof(baseProof);
		expect(md).toContain("<details>");
		expect(md).toContain("</details>");
	});

	it("should handle missing optional sections", () => {
		const minimal: VerificationProof = {
			pipeline: [],
			pipelinePassed: true,
			pipelineDuration: 0,
			tests: null,
			review: null,
			slop: null,
			visual: null,
			workflowSummary: null,
		};
		const md = formatVerificationProof(minimal);
		expect(md).toContain("## Verification Proof");
		expect(md).not.toContain("Tests:");
		expect(md).not.toContain("Visual:");
	});

	it("should show failure icons when checks fail", () => {
		const failed: VerificationProof = {
			...baseProof,
			pipelinePassed: false,
			tests: { passed: 978, failed: 2, files: 87 },
		};
		const md = formatVerificationProof(failed);
		expect(md).toContain("❌");
	});
});
