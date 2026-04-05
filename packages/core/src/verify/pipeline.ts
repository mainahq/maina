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

import { createCacheManager } from "../cache/manager";
import { getNoisyRules } from "../feedback/preferences";
import { getDiff, getStagedFiles } from "../git/index";
import { detectLanguages } from "../language/detect";
import type { LanguageId } from "../language/profile";
import { getProfile } from "../language/profile";
import { type AIReviewResult, runAIReview } from "./ai-review";
import { checkConsistency } from "./consistency";
import { runCoverage } from "./coverage";
import type { DetectedTool } from "./detect";
import { detectTools } from "./detect";
import type { Finding } from "./diff-filter";
import { filterByDiff } from "./diff-filter";
import { runMutation } from "./mutation";
import { runSecretlint } from "./secretlint";
import { runSemgrep } from "./semgrep";
import { detectSlop } from "./slop";
import { runSonar } from "./sonar";
import type { SyntaxDiagnostic } from "./syntax-guard";
import { syntaxGuard } from "./syntax-guard";
import { runTrivy } from "./trivy";
import { runTypecheck } from "./typecheck";

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
	cacheHits: number; // cache L1+L2 hits during this run
	cacheMisses: number; // cache misses during this run
}

export interface PipelineOptions {
	files?: string[]; // specific files (default: staged files)
	baseBranch?: string; // for diff filter (default: "main")
	diffOnly?: boolean; // default: true
	deep?: boolean; // NEW — triggers standard-tier AI review
	cwd?: string;
	mainaDir?: string;
	languages?: string[]; // override language detection
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
			cacheHits: 0,
			cacheMisses: 0,
		};
	}

	// ── Step 2: Syntax guard (MUST run first) ─────────────────────────────
	// Detect languages or use provided override
	const languages = options?.languages ?? detectLanguages(cwd);
	const primaryLang = (languages[0] ?? "typescript") as LanguageId;
	const profile = getProfile(primaryLang);
	const syntaxResult = await syntaxGuard(files, cwd, profile);

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
			cacheHits: 0,
			cacheMisses: 0,
		};
	}

	// ── Step 3: Auto-detect tools ─────────────────────────────────────────
	const detectedTools = await detectTools();

	// ── Step 4: Run all available tools in PARALLEL ───────────────────────
	// Build a lookup from detection results to avoid redundant subprocess spawns
	const toolAvailability = new Map<string, boolean>();
	for (const t of detectedTools) {
		toolAvailability.set(t.name, t.available);
	}

	const toolPromises: Promise<ToolReport>[] = [];

	// Slop detector always runs (no external tool dependency), cache-aware
	const mainaDir = options?.mainaDir ?? ".maina";
	const slopCache = createCacheManager(mainaDir);
	toolPromises.push(
		runToolWithTiming("slop", async () => {
			const result = await detectSlop(files, { cwd, cache: slopCache });
			return { findings: result.findings, skipped: false };
		}),
	);

	// Semgrep — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("semgrep", () =>
			runSemgrep({
				files,
				cwd,
				available: toolAvailability.get("semgrep") ?? false,
			}),
		),
	);

	// Trivy — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("trivy", () =>
			runTrivy({ cwd, available: toolAvailability.get("trivy") ?? false }),
		),
	);

	// Secretlint — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("secretlint", () =>
			runSecretlint({
				files,
				cwd,
				available: toolAvailability.get("secretlint") ?? false,
			}),
		),
	);

	// SonarQube — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("sonarqube", () =>
			runSonar({
				cwd,
				available: toolAvailability.get("sonarqube") ?? false,
			}),
		),
	);

	// Stryker mutation testing — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("stryker", () =>
			runMutation({
				cwd,
				available: toolAvailability.get("stryker") ?? false,
			}),
		),
	);

	// diff-cover — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("diff-cover", () =>
			runCoverage({
				cwd,
				available: toolAvailability.get("diff-cover") ?? false,
			}),
		),
	);

	// Built-in checks (always run, no external tool dependency)
	toolPromises.push(
		runToolWithTiming("typecheck", async () => {
			const result = await runTypecheck(files, cwd, { language: primaryLang });
			return { findings: result.findings, skipped: result.skipped };
		}),
	);

	toolPromises.push(
		runToolWithTiming("consistency", async () => {
			const result = await checkConsistency(files, cwd, mainaDir);
			return { findings: result.findings, skipped: false };
		}),
	);

	const toolReports = await Promise.all(toolPromises);

	// ── Step 4b: Warn if all external tools were skipped ─────────────────
	const builtInTools = new Set(["slop", "typecheck", "consistency"]);
	const externalTools = toolReports.filter((r) => !builtInTools.has(r.tool));
	const allExternalSkipped =
		externalTools.length > 0 && externalTools.every((r) => r.skipped);

	// ── Step 5: Collect all findings ──────────────────────────────────────
	const allFindings: Finding[] = [];
	for (const report of toolReports) {
		allFindings.push(...report.findings);
	}

	if (allExternalSkipped) {
		const skippedNames = externalTools.map((r) => r.tool).join(", ");
		allFindings.push({
			tool: "pipeline",
			file: "",
			line: 0,
			message: `WARNING: No external verification tools detected (${skippedNames} skipped). Built-in checks (typecheck, consistency, slop) still ran. Run \`maina init --install\` to add external tools.`,
			severity: "warning",
		});
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

	// ── Step 6b: Skip or downgrade noisy rules based on preferences ─────
	try {
		const noisy = getNoisyRules(mainaDir);
		const noisyMap = new Map(noisy.map((r) => [r.ruleId, r]));
		shownFindings = shownFindings.filter((finding) => {
			if (!finding.ruleId) return true;
			const rule = noisyMap.get(finding.ruleId);
			if (!rule) return true;
			// Skip entirely if FP rate > 50% — these erode trust
			if (rule.falsePositiveRate > 0.5) return false;
			// Downgrade if borderline (>30%)
			if (rule.falsePositiveRate > 0.3) {
				if (finding.severity === "error") finding.severity = "warning";
				else if (finding.severity === "warning") finding.severity = "info";
			}
			return true;
		});
	} catch {
		// Preference loading failure should never block verification
	}

	// ── Step 7: AI review (mechanical always, standard if --deep) ────────
	const deep = options?.deep ?? false;
	let diffText = "";
	try {
		diffText = diffOnly ? await getDiff(baseBranch, undefined, cwd) : "";
	} catch {
		// getDiff failure should not block pipeline
	}

	const aiReviewResult: AIReviewResult = await runAIReview({
		diff: diffText,
		entities: [], // Entities require tree-sitter + file body reads; wired when semantic index is hydrated
		deep,
		mainaDir: options?.mainaDir ?? ".maina",
	});

	const aiReport: ToolReport = {
		tool: "ai-review",
		findings: aiReviewResult.findings,
		skipped: aiReviewResult.skipped,
		duration: aiReviewResult.duration,
	};

	toolReports.push(aiReport);

	// Merge AI findings into shown findings
	shownFindings.push(...aiReviewResult.findings);

	// ── Step 8: Determine pass/fail ───────────────────────────────────────
	const passed = !shownFindings.some((f) => f.severity === "error");

	// ── Step 9: Return unified result ─────────────────────────────────────
	const cacheStats = slopCache.stats();
	return {
		passed,
		syntaxPassed: true,
		tools: toolReports,
		findings: shownFindings,
		hiddenCount,
		detectedTools,
		duration: Math.round(performance.now() - start),
		cacheHits: cacheStats.l1Hits + cacheStats.l2Hits,
		cacheMisses: cacheStats.misses,
	};
}
