/**
 * Verification Proof — gathers and formats verification evidence for PRs.
 *
 * Collects pipeline results, test count, review results, slop check,
 * and visual verification into a formatted markdown section.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createCacheManager } from "../cache/manager";
import { loadWorkflowContext } from "../workflow/context";
import type { PipelineResult } from "./pipeline";
import { runPipeline } from "./pipeline";
import { detectSlop } from "./slop";
import { runVisualVerification } from "./visual";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ToolProof {
	tool: string;
	findings: number;
	duration: number;
	skipped: boolean;
}

export interface VerificationProof {
	pipeline: ToolProof[];
	pipelinePassed: boolean;
	pipelineDuration: number;
	tests: { passed: number; failed: number; files: number } | null;
	review: {
		stage1Passed: boolean;
		stage1Findings: number;
		stage2Passed: boolean;
		stage2Findings: number;
	} | null;
	slop: { findings: number } | null;
	visual: { pages: number; regressions: number } | null;
	workflowSummary: string | null;
}

export interface ProofOptions {
	cwd?: string;
	mainaDir?: string;
	baseBranch?: string;
	skipTests?: boolean;
	skipVisual?: boolean;
	pipelineResult?: PipelineResult;
	reviewResult?: {
		passed: boolean;
		stage1: { passed: boolean; findings: unknown[] };
		stage2?: { passed: boolean; findings: unknown[] } | null;
	};
}

// ─── Gather ───────────────────────────────────────────────────────────────

/**
 * Run tests and parse the output for pass/fail count.
 */
async function runTests(
	cwd: string,
): Promise<{ passed: number; failed: number; files: number } | null> {
	try {
		const proc = Bun.spawn(["bun", "test"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		await proc.exited;

		// Parse "980 pass, 0 fail across 87 files."
		const match = stdout.match(/(\d+)\s+pass,?\s+(\d+)\s+fail.*?(\d+)\s+file/);
		if (match) {
			return {
				passed: Number.parseInt(match[1] ?? "0", 10),
				failed: Number.parseInt(match[2] ?? "0", 10),
				files: Number.parseInt(match[3] ?? "0", 10),
			};
		}

		// Fallback: just check exit code
		return null;
	} catch {
		return null;
	}
}

/**
 * Gather all verification proof.
 */
export async function gatherVerificationProof(
	options: ProofOptions = {},
): Promise<VerificationProof> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = options.mainaDir ?? join(cwd, ".maina");
	const baseBranch = options.baseBranch ?? "main";

	// Pipeline
	let pipelineResult = options.pipelineResult;
	if (!pipelineResult) {
		pipelineResult = await runPipeline({
			baseBranch,
			diffOnly: true,
			cwd,
			mainaDir,
		});
	}

	const pipeline: ToolProof[] = pipelineResult.tools.map((t) => ({
		tool: t.tool,
		findings: t.findings.length,
		duration: t.duration,
		skipped: t.skipped,
	}));

	// Tests
	const tests = options.skipTests ? null : await runTests(cwd);

	// Review (passed from caller if available)
	const review = options.reviewResult
		? {
				stage1Passed: options.reviewResult.stage1.passed,
				stage1Findings: options.reviewResult.stage1.findings.length,
				stage2Passed: options.reviewResult.stage2?.passed ?? true,
				stage2Findings: options.reviewResult.stage2?.findings.length ?? 0,
			}
		: null;

	// Slop
	let slop: { findings: number } | null = null;
	try {
		const cache = createCacheManager(mainaDir);
		const slopResult = await detectSlop([], { cwd, cache });
		slop = { findings: slopResult.findings.length };
	} catch {
		slop = null;
	}

	// Visual
	let visual: { pages: number; regressions: number } | null = null;
	if (!options.skipVisual) {
		const baselineDir = join(mainaDir, "visual-baselines");
		if (existsSync(baselineDir)) {
			try {
				const visualResult = await runVisualVerification(mainaDir);
				if (!visualResult.skipped) {
					const regressions = visualResult.findings.filter(
						(f) => f.ruleId === "visual/regression",
					).length;
					visual = { pages: visualResult.comparisons, regressions };
				}
			} catch {
				// Visual verification failure shouldn't block PR
			}
		}
	}

	// Workflow context
	const workflowSummary = loadWorkflowContext(mainaDir);

	return {
		pipeline,
		pipelinePassed: pipelineResult.passed,
		pipelineDuration: pipelineResult.duration,
		tests,
		review,
		slop,
		visual,
		workflowSummary,
	};
}

// ─── Format ───────────────────────────────────────────────────────────────

/**
 * Format verification proof as a markdown section with collapsible details.
 */
export function formatVerificationProof(proof: VerificationProof): string {
	const sections: string[] = [];
	sections.push("\n## Verification Proof\n");

	// Pipeline
	const pipelineIcon = proof.pipelinePassed ? "✅" : "❌";
	const toolCount = proof.pipeline.length;
	const totalFindings = proof.pipeline.reduce((sum, t) => sum + t.findings, 0);
	const duration = (proof.pipelineDuration / 1000).toFixed(1);

	sections.push(`<details>`);
	sections.push(
		`<summary>${pipelineIcon} Pipeline: ${toolCount} tools, ${totalFindings} findings, ${duration}s</summary>\n`,
	);
	sections.push("| Tool | Findings | Duration | Status |");
	sections.push("|------|----------|----------|--------|");
	for (const t of proof.pipeline) {
		const status = t.skipped
			? "skipped"
			: t.findings > 0
				? `${t.findings} found`
				: "✅";
		const dur = t.skipped ? "-" : `${t.duration}ms`;
		const findings = t.skipped ? "-" : String(t.findings);
		sections.push(`| ${t.tool} | ${findings} | ${dur} | ${status} |`);
	}
	sections.push("\n</details>\n");

	// Tests
	if (proof.tests) {
		const testIcon = proof.tests.failed === 0 ? "✅" : "❌";
		sections.push(`<details>`);
		sections.push(
			`<summary>${testIcon} Tests: ${proof.tests.passed} pass, ${proof.tests.failed} fail</summary>\n`,
		);
		sections.push(
			`${proof.tests.passed} pass, ${proof.tests.failed} fail across ${proof.tests.files} files.`,
		);
		sections.push("\n</details>\n");
	}

	// Code Review
	if (proof.review) {
		const reviewIcon =
			proof.review.stage1Passed && proof.review.stage2Passed ? "✅" : "⚠️";
		sections.push(`<details>`);
		sections.push(`<summary>${reviewIcon} Code Review</summary>\n`);
		sections.push(
			`- Stage 1 (spec compliance): ${proof.review.stage1Passed ? "passed" : "failed"}, ${proof.review.stage1Findings} finding(s)`,
		);
		sections.push(
			`- Stage 2 (code quality): ${proof.review.stage2Passed ? "passed" : "failed"}, ${proof.review.stage2Findings} finding(s)`,
		);
		sections.push("\n</details>\n");
	}

	// Slop
	if (proof.slop) {
		const slopIcon = proof.slop.findings === 0 ? "✅" : "⚠️";
		sections.push(`<details>`);
		sections.push(
			`<summary>${slopIcon} Slop: ${proof.slop.findings === 0 ? "clean" : `${proof.slop.findings} patterns`}</summary>\n`,
		);
		sections.push(`${proof.slop.findings} slop pattern(s) detected.`);
		sections.push("\n</details>\n");
	}

	// Visual
	if (proof.visual) {
		const visualIcon = proof.visual.regressions === 0 ? "✅" : "⚠️";
		sections.push(`<details>`);
		sections.push(
			`<summary>${visualIcon} Visual: ${proof.visual.pages} page(s), ${proof.visual.regressions} regression(s)</summary>\n`,
		);
		sections.push(
			`Compared ${proof.visual.pages} page(s) against baselines. ${proof.visual.regressions} regression(s) found.`,
		);
		sections.push("\n</details>\n");
	}

	// Workflow
	if (proof.workflowSummary) {
		sections.push(`<details>`);
		sections.push(`<summary>📋 Workflow Context</summary>\n`);
		sections.push("```");
		// Truncate to last 500 chars to keep PR body reasonable
		const summary =
			proof.workflowSummary.length > 500
				? `...${proof.workflowSummary.slice(-500)}`
				: proof.workflowSummary;
		sections.push(summary);
		sections.push("```");
		sections.push("\n</details>");
	}

	return sections.join("\n");
}
