/**
 * Verify Pipeline Orchestrator — ties together all verification tools.
 *
 * Pipeline flow:
 * 1. Get files to check (staged files, or provided list)
 * 2. Run syntax guard FIRST — abort immediately if it fails
 * 3. Auto-detect available tools
 * 4. Run all available tools in PARALLEL (slop, semgrep, trivy, secretlint)
 * 5. Collect all findings
 * 6. Apply diff-only filter (unless diffOnly === false)
 * 7. Determine pass/fail: passed = no error-severity findings
 * 8. Return unified PipelineResult
 */

import { getStagedFiles } from "../git/index";
import type { DetectedTool } from "./detect";
import { detectTools } from "./detect";
import type { Finding } from "./diff-filter";
import { filterByDiff } from "./diff-filter";
import { runSecretlint } from "./secretlint";
import { runSemgrep } from "./semgrep";
import { detectSlop } from "./slop";
import type { SyntaxDiagnostic } from "./syntax-guard";
import { syntaxGuard } from "./syntax-guard";
import { runTrivy } from "./trivy";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ToolReport {
	tool: string;
	findings: Finding[];
	skipped: boolean;
	duration: number; // ms
}

export interface PipelineResult {
	passed: boolean; // true if no errors
	syntaxPassed: boolean; // syntax guard result
	syntaxErrors?: SyntaxDiagnostic[];
	tools: ToolReport[]; // per-tool results
	findings: Finding[]; // all shown findings (after diff filter)
	hiddenCount: number; // pre-existing findings hidden
	detectedTools: DetectedTool[]; // what was found on PATH
	duration: number; // total ms
}

export interface PipelineOptions {
	files?: string[]; // specific files (default: staged files)
	baseBranch?: string; // for diff filter (default: "main")
	diffOnly?: boolean; // default: true
	cwd?: string;
	mainaDir?: string;
}

// ─── Tool Runner Helpers ──────────────────────────────────────────────────

/**
 * Run a single tool and wrap the result in a ToolReport with timing.
 */
async function runToolWithTiming(
	toolName: string,
	fn: () => Promise<{ findings: Finding[]; skipped: boolean }>,
): Promise<ToolReport> {
	const start = performance.now();
	const result = await fn();
	const duration = Math.round(performance.now() - start);

	return {
		tool: toolName,
		findings: result.findings,
		skipped: result.skipped,
		duration,
	};
}

// ─── Pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the full verification pipeline.
 *
 * Orchestrates: syntax guard -> tool detection -> parallel tool execution
 * -> diff-only filtering -> unified result.
 */
export async function runPipeline(
	options?: PipelineOptions,
): Promise<PipelineResult> {
	const start = performance.now();
	const cwd = options?.cwd ?? process.cwd();
	const diffOnly = options?.diffOnly !== false; // default: true
	const baseBranch = options?.baseBranch ?? "main";

	// ── Step 1: Get files to check ────────────────────────────────────────
	const files = options?.files ?? (await getStagedFiles(cwd));

	// Empty file list → nothing to verify
	if (files.length === 0) {
		return {
			passed: true,
			syntaxPassed: true,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: Math.round(performance.now() - start),
		};
	}

	// ── Step 2: Syntax guard (MUST run first) ─────────────────────────────
	const syntaxResult = await syntaxGuard(files, cwd);

	if (!syntaxResult.ok) {
		return {
			passed: false,
			syntaxPassed: false,
			syntaxErrors: syntaxResult.error,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: Math.round(performance.now() - start),
		};
	}

	// ── Step 3: Auto-detect tools ─────────────────────────────────────────
	const detectedTools = await detectTools();

	// ── Step 4: Run all available tools in PARALLEL ───────────────────────
	const toolPromises: Promise<ToolReport>[] = [];

	// Slop detector always runs (no external tool dependency)
	toolPromises.push(
		runToolWithTiming("slop", async () => {
			const result = await detectSlop(files, { cwd });
			return { findings: result.findings, skipped: false };
		}),
	);

	// Semgrep
	toolPromises.push(
		runToolWithTiming("semgrep", () => runSemgrep({ files, cwd })),
	);

	// Trivy
	toolPromises.push(runToolWithTiming("trivy", () => runTrivy({ cwd })));

	// Secretlint
	toolPromises.push(
		runToolWithTiming("secretlint", () => runSecretlint({ files, cwd })),
	);

	const toolReports = await Promise.all(toolPromises);

	// ── Step 5: Collect all findings ──────────────────────────────────────
	const allFindings: Finding[] = [];
	for (const report of toolReports) {
		allFindings.push(...report.findings);
	}

	// ── Step 6: Apply diff-only filter ────────────────────────────────────
	let shownFindings: Finding[];
	let hiddenCount: number;

	if (diffOnly) {
		const filtered = await filterByDiff(allFindings, baseBranch, cwd);
		shownFindings = filtered.shown;
		hiddenCount = filtered.hidden;
	} else {
		shownFindings = allFindings;
		hiddenCount = 0;
	}

	// ── Step 7: Determine pass/fail ───────────────────────────────────────
	const passed = !shownFindings.some((f) => f.severity === "error");

	// ── Step 8: Return unified result ─────────────────────────────────────
	return {
		passed,
		syntaxPassed: true,
		tools: toolReports,
		findings: shownFindings,
		hiddenCount,
		detectedTools,
		duration: Math.round(performance.now() - start),
	};
}
