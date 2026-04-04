import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type { Finding, FixSuggestion, PipelineResult } from "@maina/core";
import {
	appendWorkflowStep,
	generateFixes,
	getCurrentBranch,
	getStagedFiles,
	getTrackedFiles,
	getWorkflowId,
	recordFeedbackAsync,
	runPipeline,
	runVisualVerification,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VerifyActionOptions {
	all?: boolean;
	fix?: boolean;
	json?: boolean;
	base?: string;
	deep?: boolean;
	visual?: boolean;
	cwd?: string;
}

export interface VerifyActionResult {
	passed: boolean;
	findingsCount: number;
	hiddenCount: number;
	duration: number;
	syntaxErrors?: Array<{
		file: string;
		line: number;
		column: number;
		message: string;
	}>;
	fixSuggestions?: FixSuggestion[];
	json?: string;
}

// ── Formatting Helpers ───────────────────────────────────────────────────────

function formatFindingsTable(findings: Finding[]): string {
	if (findings.length === 0) return "  No findings.";
	const header = `  ${"Tool".padEnd(12)} ${"File".padEnd(20)} ${"Line".padStart(5)}  ${"Severity".padEnd(8)}  Message`;
	const separator = `  ${"─".repeat(12)} ${"─".repeat(20)} ${"─".repeat(5)}  ${"─".repeat(8)}  ${"─".repeat(30)}`;
	const rows = findings.map((f) => {
		const file =
			f.file.length > 18 ? `…${f.file.slice(f.file.length - 17)}` : f.file;
		return `  ${f.tool.padEnd(12)} ${file.padEnd(20)} ${String(f.line).padStart(5)}  ${f.severity.padEnd(8)}  ${f.message}`;
	});
	return [header, separator, ...rows].join("\n");
}

function formatSyntaxErrors(
	errors: Array<{
		file: string;
		line: number;
		column: number;
		message: string;
	}>,
): string {
	return errors
		.map((e) => `  ${e.file}:${e.line}:${e.column} — ${e.message}`)
		.join("\n");
}

function formatFixSuggestions(suggestions: FixSuggestion[]): string {
	if (suggestions.length === 0) return "  No fix suggestions generated.";
	return suggestions
		.map((s) => {
			const header = `  Fix for ${s.finding.tool} at ${s.finding.file}:${s.finding.line} [${s.confidence}]`;
			const explanation = `  ${s.explanation}`;
			const diff = s.diff
				.split("\n")
				.map((line) => `    ${line}`)
				.join("\n");
			return `${header}\n${explanation}\n${diff}`;
		})
		.join("\n\n");
}

// ── Core Action (testable) ──────────────────────────────────────────────────

/**
 * The core verify logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function verifyAction(
	options: VerifyActionOptions,
): Promise<VerifyActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const baseBranch = options.base ?? "main";

	// ── Step 1: Determine files to check ──────────────────────────────────
	const pipelineOpts: {
		files?: string[];
		baseBranch: string;
		diffOnly: boolean;
		deep: boolean;
		cwd: string;
		mainaDir: string;
	} = {
		baseBranch,
		diffOnly: !options.all,
		deep: options.deep ?? false,
		cwd,
		mainaDir,
	};

	if (options.all) {
		// --all: scan all tracked files in the repo
		const allFiles = await getTrackedFiles(cwd);
		pipelineOpts.files = allFiles;
	} else {
		const stagedFiles = await getStagedFiles(cwd);
		pipelineOpts.files = stagedFiles;
	}

	// ── Step 2: Run pipeline ──────────────────────────────────────────────
	const pipelineResult: PipelineResult = await runPipeline(pipelineOpts);

	// ── Step 3: Build result ──────────────────────────────────────────────
	const result: VerifyActionResult = {
		passed: pipelineResult.passed,
		findingsCount: pipelineResult.findings.length,
		hiddenCount: pipelineResult.hiddenCount,
		duration: pipelineResult.duration,
	};

	// Syntax errors
	if (!pipelineResult.syntaxPassed && pipelineResult.syntaxErrors) {
		result.syntaxErrors = pipelineResult.syntaxErrors;
		if (!options.json) {
			log.error("Syntax check failed:");
			log.message(formatSyntaxErrors(pipelineResult.syntaxErrors));
		}
	}

	// Findings
	if (!options.json && pipelineResult.findings.length > 0) {
		log.message(formatFindingsTable(pipelineResult.findings));
	}

	if (!options.json && pipelineResult.hiddenCount > 0) {
		log.info(
			`${pipelineResult.hiddenCount} pre-existing issue(s) hidden (diff-only mode).`,
		);
	}

	// ── Step 4: AI Fix suggestions (if --fix and findings exist) ──────────
	if (options.fix && pipelineResult.findings.length > 0) {
		const fixResult = await generateFixes(pipelineResult.findings, {
			mainaDir,
			cwd,
		});
		result.fixSuggestions = fixResult.suggestions;

		if (!options.json && fixResult.suggestions.length > 0) {
			log.step("AI Fix Suggestions:");
			log.message(formatFixSuggestions(fixResult.suggestions));
		}
	}

	// ── Step 4b: Visual verification (if --visual) ──────────────────────
	if (options.visual) {
		const visualResult = await runVisualVerification(mainaDir);

		if (!visualResult.skipped && visualResult.findings.length > 0) {
			if (!options.json) {
				log.step("Visual Verification:");
				for (const f of visualResult.findings as Finding[]) {
					const icon = f.severity === "warning" ? "⚠" : "ℹ";
					log.message(`  ${icon} ${f.file || "visual"}: ${f.message}`);
				}
			}

			// Add visual findings to the result
			result.findingsCount += visualResult.findings.length;
			if (
				(visualResult.findings as Finding[]).some((f) => f.severity === "error")
			) {
				result.passed = false;
			}
		} else if (visualResult.skipped && !options.json) {
			log.info(
				"Visual verification skipped (no baselines or Playwright not installed).",
			);
		}
	}

	// ── Step 5: JSON output ──────────────────────────────────────────────
	if (options.json) {
		const jsonOutput = {
			passed: pipelineResult.passed,
			syntaxPassed: pipelineResult.syntaxPassed,
			syntaxErrors: pipelineResult.syntaxErrors,
			findings: pipelineResult.findings,
			hiddenCount: pipelineResult.hiddenCount,
			tools: pipelineResult.tools.map((t) => ({
				tool: t.tool,
				findingsCount: t.findings.length,
				skipped: t.skipped,
				duration: t.duration,
			})),
			duration: pipelineResult.duration,
			fixSuggestions: result.fixSuggestions,
		};
		result.json = JSON.stringify(jsonOutput, null, 2);
	}

	// ── Step 6: Summary ──────────────────────────────────────────────────
	if (!options.json) {
		if (pipelineResult.passed) {
			log.success(
				`Verification passed in ${pipelineResult.duration}ms. ${pipelineResult.tools.length} tool(s) ran.`,
			);
		} else {
			log.error(
				`Verification failed: ${pipelineResult.findings.length} finding(s).`,
			);
		}
	}

	const wfMainaDir = join(cwd, ".maina");
	appendWorkflowStep(
		wfMainaDir,
		"verify",
		`Pipeline ${result.passed ? "passed" : "failed"}: ${result.findingsCount} findings, ${result.duration}ms.`,
	);

	const branch = await getCurrentBranch(cwd);
	const workflowId = getWorkflowId(branch);
	recordFeedbackAsync(wfMainaDir, {
		promptHash: "deterministic",
		task: "verify",
		accepted: result.passed,
		timestamp: new Date().toISOString(),
		workflowStep: "verify",
		workflowId,
	});

	return result;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function verifyCommand(): Command {
	return new Command("verify")
		.description("Run full verification pipeline")
		.option("--all", "Scan all files, not just changed")
		.option("--fix", "Show AI fix suggestions")
		.option("--json", "Output JSON for CI")
		.option("--base <ref>", "Base branch for diff", "main")
		.option("--deep", "Run standard-tier AI semantic review")
		.option("--visual", "Run visual regression checks")
		.action(async (options) => {
			intro("maina verify");

			const s = spinner();
			s.start("Running verification pipeline…");

			const result = await verifyAction({
				all: options.all,
				fix: options.fix,
				json: options.json,
				base: options.base,
				deep: options.deep,
				visual: options.visual,
			});

			s.stop("Pipeline complete.");

			if (result.json) {
				// For CI, output raw JSON
				process.stdout.write(`${result.json}\n`);
			}

			if (result.passed) {
				outro("Verification passed.");
			} else {
				outro("Verification failed.");
			}
		});
}
