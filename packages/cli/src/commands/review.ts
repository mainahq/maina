import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import {
	type ComprehensiveReviewResult,
	comprehensiveReview,
	getChangedFiles,
	getDiff,
	recordFeedbackWithCompression,
} from "@mainahq/core";
import { Command } from "commander";
import { exitCodeFromResult, outputJson } from "../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReviewActionOptions {
	base?: string;
	planPath?: string;
	json?: boolean;
	cwd?: string;
}

export interface ReviewActionResult {
	reviewed: boolean;
	reason?: string;
	result?: ComprehensiveReviewResult;
}

export interface ReviewDeps {
	getDiff: (ref1?: string, ref2?: string, cwd?: string) => Promise<string>;
	getChangedFiles: (since?: string, cwd?: string) => Promise<string[]>;
	comprehensiveReview: typeof comprehensiveReview;
}

const defaultDeps: ReviewDeps = {
	getDiff,
	getChangedFiles,
	comprehensiveReview,
};

// ── Display ─────────────────────────────────────────────────────────────────

function displayReview(result: ComprehensiveReviewResult): void {
	// Strengths
	if (result.strengths.length > 0) {
		log.success("Strengths:");
		for (const s of result.strengths) {
			log.message(`  + ${s}`);
		}
		log.message("");
	}

	// Findings by severity
	const critical = result.findings.filter((f) => f.severity === "critical");
	const important = result.findings.filter((f) => f.severity === "important");
	const minor = result.findings.filter((f) => f.severity === "minor");

	if (critical.length > 0) {
		log.error(`Critical (${critical.length}):`);
		for (const f of critical) {
			const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
			log.message(`  ${loc}`);
			log.message(`    Issue: ${f.issue}`);
			log.message(`    Why: ${f.why}`);
			if (f.fix) log.message(`    Fix: ${f.fix}`);
		}
		log.message("");
	}

	if (important.length > 0) {
		log.warning(`Important (${important.length}):`);
		for (const f of important) {
			const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
			log.message(`  ${loc}`);
			log.message(`    Issue: ${f.issue}`);
			log.message(`    Why: ${f.why}`);
			if (f.fix) log.message(`    Fix: ${f.fix}`);
		}
		log.message("");
	}

	if (minor.length > 0) {
		log.info(`Minor (${minor.length}):`);
		for (const f of minor) {
			const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
			log.message(`  ${loc} — ${f.issue}`);
		}
		log.message("");
	}

	// Plan alignment
	if (result.planAlignment.tasksInPlan > 0) {
		log.info(
			`Plan alignment: ${result.planAlignment.tasksWithChanges}/${result.planAlignment.tasksInPlan} tasks implemented`,
		);
		if (result.planAlignment.missingImpl.length > 0) {
			for (const m of result.planAlignment.missingImpl) {
				log.warning(`  Missing: ${m}`);
			}
		}
	}

	// Testing
	log.info(
		`Testing: ${result.testing.testFiles} test / ${result.testing.implFiles} impl (${result.testing.ratio})`,
	);
	if (result.testing.gaps.length > 0) {
		for (const g of result.testing.gaps.slice(0, 5)) {
			log.warning(`  No test: ${g}`);
		}
	}

	// Architecture
	if (result.architecture.notes.length > 0) {
		log.info("Architecture notes:");
		for (const n of result.architecture.notes) {
			log.message(`  ${n}`);
		}
	}

	// Verdict
	log.message("");
	const verdictIcon =
		result.verdict === "ready"
			? "READY"
			: result.verdict === "with-fixes"
				? "WITH FIXES"
				: "NOT READY";
	log.info(`Verdict: ${verdictIcon} — ${result.verdictReason}`);
}

// ── Core Action ─────────────────────────────────────────────────────────────

export async function reviewAction(
	options: ReviewActionOptions,
	deps: ReviewDeps = defaultDeps,
): Promise<ReviewActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const base = options.base ?? "HEAD~1";

	// Get diff
	const diff = await deps.getDiff(base, undefined, cwd);
	if (!diff.trim()) {
		return { reviewed: false, reason: "No changes to review" };
	}

	// Get changed files
	const files = await deps.getChangedFiles(base, cwd);

	// Load plan if specified or auto-detect from current feature
	let planContent: string | null = null;
	if (options.planPath) {
		try {
			planContent = await Bun.file(options.planPath).text();
		} catch {
			// Plan file not found — skip plan alignment
		}
	}

	// Run comprehensive review
	const result = deps.comprehensiveReview({
		diff,
		files: files.map((f) => join(cwd, f)),
		repoRoot: cwd,
		planContent,
	});

	return { reviewed: true, result };
}

// ── Commander Command ───────────────────────────────────────────────────────

export function reviewCommand(): Command {
	return new Command("review")
		.description("Comprehensive code review (Superpowers-style)")
		.option("--base <ref>", "Base ref to diff against", "HEAD~1")
		.option("--plan <path>", "Plan file for alignment check")
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			if (!options.json) intro("maina review");

			const result = await reviewAction({
				base: options.base,
				planPath: options.plan,
				json: options.json,
			});

			if (!result.reviewed) {
				if (options.json) {
					outputJson(
						{ passed: true, stage1: null, stage2: null, findings: [] },
						0,
					);
					return;
				}
				log.warning(result.reason ?? "Unknown error");
				outro("Done.");
				return;
			}

			if (result.result) {
				if (options.json) {
					const passed = result.result.verdict !== "not-ready";
					outputJson(
						{
							passed,
							stage1: {
								verdict: result.result.verdict,
								verdictReason: result.result.verdictReason,
								strengths: result.result.strengths,
							},
							stage2: {
								architecture: result.result.architecture,
								testing: result.result.testing,
								planAlignment: result.result.planAlignment,
							},
							findings: result.result.findings,
						},
						exitCodeFromResult({ passed }),
					);
					return;
				}

				displayReview(result.result);

				// Record feedback for RL loop + episodic compression
				const mainaDir = join(process.cwd(), ".maina");
				const accepted = result.result.verdict !== "not-ready";
				try {
					recordFeedbackWithCompression(mainaDir, {
						promptHash: "review",
						task: "review",
						accepted,
						timestamp: new Date().toISOString(),
						modification: `verdict: ${result.result.verdict}`,
						aiOutput: result.result.verdictReason,
					});
				} catch {
					// Feedback recording should never block the review
				}
			}

			if (!options.json) outro("Done.");
		});
}
