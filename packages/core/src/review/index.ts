/**
 * Two-stage PR Review.
 *
 * Stage 1 — Spec Compliance: checks diff against implementation plan tasks.
 * Stage 2 — Code Quality: checks added lines for common issues.
 *
 * Deterministic checks only — no AI calls.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AIContext } from "../ai/index";
import { decideEach, defaultDecidePorts } from "../decide/decide";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReviewStageResult {
	stage: "spec-compliance" | "code-quality";
	passed: boolean;
	findings: ReviewFinding[];
}

export interface ReviewFinding {
	stage: "spec-compliance" | "code-quality";
	severity: "error" | "warning" | "info";
	message: string;
	file?: string;
	line?: number;
}

export interface ReviewOptions {
	diff: string;
	planContent?: string | null;
	conventions?: string | null;
	mainaDir?: string; // enables AI review (with `ai`) and decision loading
	/** Root + env for the AI review; stage 2 is deterministic without it. */
	ai?: AIContext;
	/** Accepted ADR summaries for spec compliance checking */
	decisionSummaries?: string[] | null;
}

export interface ReviewResult {
	stage1: ReviewStageResult;
	stage2: ReviewStageResult | null; // null if stage 1 failed
	passed: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract task descriptions from a plan's task list.
 * Matches lines like `- [ ] Do something` or `- [x] Do something`.
 */
function extractTasks(planContent: string): string[] {
	const taskPattern = /^[-*]\s+\[[ x]\]\s+(.+)/gim;
	const tasks: string[] = [];
	let match = taskPattern.exec(planContent);
	while (match !== null) {
		if (match[1]) {
			tasks.push(match[1].trim());
		}
		match = taskPattern.exec(planContent);
	}
	return tasks;
}

/**
 * Extract files touched in a unified diff.
 * Looks for `diff --git a/... b/...` headers.
 */
function extractDiffFiles(diff: string): string[] {
	const filePattern = /^diff --git a\/(.+?) b\/(.+)$/gm;
	const files: string[] = [];
	let match = filePattern.exec(diff);
	while (match !== null) {
		if (match[2]) {
			files.push(match[2]);
		}
		match = filePattern.exec(diff);
	}
	return [...new Set(files)];
}

/**
 * Extract keywords from a task description for matching against file paths.
 * Splits on whitespace and common separators, lowercases, filters noise.
 */
function extractKeywords(task: string): string[] {
	const NOISE_WORDS = new Set([
		"a",
		"an",
		"the",
		"to",
		"in",
		"on",
		"for",
		"and",
		"or",
		"with",
		"from",
		"add",
		"update",
		"fix",
		"remove",
		"create",
		"implement",
		"refactor",
		"delete",
		"modify",
		"change",
	]);

	return task
		.split(/[\s/\\.,;:()]+/)
		.map((w) => w.toLowerCase().replace(/[^a-z0-9-_]/g, ""))
		.filter((w) => w.length > 1 && !NOISE_WORDS.has(w));
}

/** Tool pairs where an accepted ADR choosing the first rules out the second. */
const ADR_TOOL_CONFLICTS: ReadonlyArray<readonly [string, string]> = [
	["biome", "eslint"],
	["biome", "prettier"],
	["bun:test", "jest"],
	["bun:test", "vitest"],
];

/**
 * Extract added lines from a unified diff (lines starting with `+`, excluding `+++` header).
 */
function extractAddedLines(
	diff: string,
): Array<{ text: string; file: string; lineNum: number }> {
	const lines = diff.split("\n");
	const added: Array<{ text: string; file: string; lineNum: number }> = [];
	let currentFile = "";
	let lineNum = 0;

	for (const line of lines) {
		// Track current file
		const fileMatch = line.match(/^diff --git a\/.+ b\/(.+)$/);
		if (fileMatch?.[1]) {
			currentFile = fileMatch[1];
			lineNum = 0;
			continue;
		}

		// Track line numbers from hunk headers
		const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
		if (hunkMatch?.[1]) {
			lineNum = Number.parseInt(hunkMatch[1], 10) - 1;
			continue;
		}

		// Count added and context lines for line tracking
		if (line.startsWith("+") && !line.startsWith("+++")) {
			lineNum++;
			added.push({ text: line.slice(1), file: currentFile, lineNum });
		} else if (line.startsWith("-")) {
			// Removed lines don't increment the new-file line counter
		} else if (!line.startsWith("\\")) {
			// Context line
			lineNum++;
		}
	}

	return added;
}

// ── Stage 1: Spec Compliance ────────────────────────────────────────────────

/**
 * Review spec compliance by checking if the diff covers all plan tasks.
 *
 * - If planContent is null/empty, skip stage 1 and return passed.
 * - Flags tasks with no corresponding file changes (missing implementation).
 * - Flags changed files that don't map to any task (over-building).
 */
export function reviewSpecCompliance(
	diff: string,
	planContent: string | null,
	decisionSummaries?: string[] | null,
): ReviewStageResult {
	const findings: ReviewFinding[] = [];

	if (!planContent) {
		return {
			stage: "spec-compliance",
			passed: true,
			findings: [],
		};
	}

	const tasks = extractTasks(planContent);
	const diffFiles = extractDiffFiles(diff);

	if (tasks.length === 0) {
		// Plan exists but no tasks extracted — pass through
		return {
			stage: "spec-compliance",
			passed: true,
			findings: [],
		};
	}

	// Is each task covered by a changed file (`spec.coverage`)?
	const taskKeywords = tasks.map(extractKeywords);
	const covered = decideEach(defaultDecidePorts, {
		type: "spec.coverage",
		check: "task",
		untrusted: taskKeywords.map((keywords) => ({ keywords })),
		shared: { untrusted: { files: diffFiles } },
	});
	for (const [i, task] of tasks.entries()) {
		if (covered[i] === false) {
			findings.push({
				stage: "spec-compliance",
				severity: "warning",
				message: `Missing implementation for task: "${task}"`,
			});
		}
	}

	// Is each changed file mapped to no task, i.e. over-building (`spec.orphan`)?
	const orphaned = decideEach(defaultDecidePorts, {
		type: "spec.orphan",
		check: "file",
		untrusted: diffFiles.map((file) => ({ file })),
		shared: { untrusted: { taskKeywords } },
	});
	for (const [i, file] of diffFiles.entries()) {
		if (orphaned[i]) {
			findings.push({
				stage: "spec-compliance",
				severity: "info",
				message: `Possible over-building: "${file}" not mapped to any plan task`,
				file,
			});
		}
	}

	// Does the added code contradict an accepted ADR (`spec.contradiction`)?
	if (decisionSummaries && decisionSummaries.length > 0) {
		const addedLines = extractAddedLines(diff);
		const addedText = addedLines.map((l) => l.text.toLowerCase()).join(" ");
		const pairs = decisionSummaries.flatMap((summary) =>
			ADR_TOOL_CONFLICTS.map(([preferred, rejected]) => ({
				summary,
				preferred,
				rejected,
			})),
		);
		const contradicts = decideEach(defaultDecidePorts, {
			type: "spec.contradiction",
			check: "adr",
			trusted: pairs.map(({ preferred, rejected }) => ({
				preferred,
				rejected,
			})),
			untrusted: pairs.map(({ summary }) => ({ summary })),
			shared: { untrusted: { addedText } },
		});
		for (const [i, { summary, preferred, rejected }] of pairs.entries()) {
			if (contradicts[i]) {
				findings.push({
					stage: "spec-compliance",
					severity: "warning",
					message: `ADR requires ${preferred} but added code references ${rejected}: "${summary.slice(0, 80)}"`,
				});
			}
		}
	}

	const hasWarningsOrErrors = findings.some(
		(f) => f.severity === "warning" || f.severity === "error",
	);

	return {
		stage: "spec-compliance",
		passed: !hasWarningsOrErrors,
		findings,
	};
}

// ── Stage 2: Code Quality ───────────────────────────────────────────────────

/** `slop` checks run on each added line, with the finding each one raises. */
const DIFF_CHECKS: ReadonlyArray<
	Readonly<{
		id: string;
		severity: ReviewFinding["severity"];
		message: (text: string) => string;
	}>
> = [
	{
		id: "diff-console-log",
		severity: "warning",
		message: () => "console.log found in added code",
	},
	{
		id: "diff-todo",
		severity: "warning",
		message: () => "TODO without ticket reference in added code",
	},
	{
		id: "diff-empty-body",
		severity: "warning",
		message: () => "Empty function body in added code",
	},
	{
		id: "diff-long-line",
		severity: "info",
		message: (text) => `Long line (${text.length} chars) in added code`,
	},
];

/**
 * Review code quality by checking added lines for common issues.
 *
 * Checks:
 * - console.log in added lines
 * - TODO without ticket reference (e.g., #123) in added lines
 * - Empty function bodies in added lines
 * - Very long lines (>120 chars) in added lines
 */
export function reviewCodeQuality(
	diff: string,
	_conventions: string | null,
): ReviewStageResult {
	const findings: ReviewFinding[] = [];
	const addedLines = extractAddedLines(diff);
	const lines = addedLines.map(({ text }) => ({ text }));

	// One `slop` decision per added line and check, in this order per line.
	const flagged = DIFF_CHECKS.map((check) =>
		decideEach(defaultDecidePorts, {
			type: "slop",
			check: check.id,
			untrusted: lines,
		}),
	);

	for (const [i, { text, file, lineNum }] of addedLines.entries()) {
		for (const [c, check] of DIFF_CHECKS.entries()) {
			if (!flagged[c]?.[i]) continue;
			findings.push({
				stage: "code-quality",
				severity: check.severity,
				message: check.message(text),
				file,
				line: lineNum,
			});
		}
	}

	const hasWarningsOrErrors = findings.some(
		(f) => f.severity === "warning" || f.severity === "error",
	);

	return {
		stage: "code-quality",
		passed: !hasWarningsOrErrors,
		findings,
	};
}

// ── AI-Enhanced Code Quality Review ─────────────────────────────────────────

/**
 * Run code quality review with optional AI enhancement.
 *
 * Always runs deterministic checks first. If an API key is available and
 * mainaDir is provided, also runs an AI-powered review and merges findings.
 * AI failure never blocks the review — deterministic results are always returned.
 */
export async function reviewCodeQualityWithAI(
	diff: string,
	conventions: string | null,
	mainaDir: string,
	ctx: AIContext,
): Promise<ReviewStageResult> {
	// Always run deterministic checks first
	const deterministicResult = reviewCodeQuality(diff, conventions);

	// Try AI review if API key available
	try {
		const { tryAIGenerate } = await import("../ai/try-generate");
		const aiResult = await tryAIGenerate(
			"review",
			mainaDir,
			{
				diff,
				conventions: conventions ?? "",
				constitution: "",
				language: "TypeScript",
			},
			`Review this diff:\n\n${diff}`,
			ctx,
		);

		// Parse AI findings and merge with deterministic ones
		if (aiResult.text && aiResult.fromAI) {
			deterministicResult.findings.push({
				stage: "code-quality",
				severity: "info",
				message: `AI review: ${aiResult.text.slice(0, 200)}${aiResult.text.length > 200 ? "..." : ""}`,
			});
		} else if (aiResult.hostDelegation && aiResult.delegation) {
			// Host mode — include delegation note for the host agent
			deterministicResult.findings.push({
				stage: "code-quality",
				severity: "info",
				message:
					"AI review delegated to host agent. Deterministic checks complete.",
			});
		}
	} catch {
		// AI failure should never block review
	}

	return deterministicResult;
}

// ── Decision Loader ─────────────────────────────────────────────────────────

/**
 * Load accepted ADR summaries from the wiki decisions directory.
 * Returns an array of one-line summaries for each accepted decision.
 */
function loadDecisionSummaries(mainaDir: string): string[] | null {
	const decisionsDir = join(mainaDir, "wiki", "decisions");
	if (!existsSync(decisionsDir)) return null;

	let entries: string[];
	try {
		entries = readdirSync(decisionsDir);
	} catch {
		return null;
	}

	const summaries: string[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		try {
			const content = readFileSync(join(decisionsDir, entry), "utf-8");
			const statusMatch = content.match(/>\s*Status:\s*\*\*(\w+)\*\*/);
			const status = statusMatch?.[1] ?? "";
			if (status !== "accepted") continue;

			const titleMatch = content.match(/^#\s+(.+)/);
			const title =
				titleMatch?.[1]?.replace(/^Decision:\s*/i, "").trim() ?? entry;

			// Extract key constraint from decision section
			const decisionMatch = content.match(
				/## Decision\n\n([\s\S]*?)(?=\n## |\n---|$)/,
			);
			const decision = decisionMatch?.[1]?.trim().split("\n")[0] ?? "";

			summaries.push(`${title}: ${decision}`);
		} catch {
			// skip unreadable files
		}
	}

	return summaries.length > 0 ? summaries : null;
}

// ── Two-Stage Review ────────────────────────────────────────────────────────

/**
 * Run the two-stage PR review pipeline.
 *
 * Stage 1: Spec compliance. If it fails, return without running stage 2.
 * Stage 2: Code quality. Uses AI-enhanced review when mainaDir is provided.
 * Returns combined result.
 */
export async function runTwoStageReview(
	options: ReviewOptions,
): Promise<ReviewResult> {
	// Load decision summaries from wiki if mainaDir is provided
	let decisionSummaries = options.decisionSummaries ?? null;
	if (!decisionSummaries && options.mainaDir) {
		decisionSummaries = loadDecisionSummaries(options.mainaDir);
	}

	const stage1 = reviewSpecCompliance(
		options.diff,
		options.planContent ?? null,
		decisionSummaries,
	);

	if (!stage1.passed) {
		return {
			stage1,
			stage2: null,
			passed: false,
		};
	}

	const stage2 =
		options.mainaDir && options.ai
			? await reviewCodeQualityWithAI(
					options.diff,
					options.conventions ?? null,
					options.mainaDir,
					options.ai,
				)
			: reviewCodeQuality(options.diff, options.conventions ?? null);

	return {
		stage1,
		stage2,
		passed: stage1.passed && stage2.passed,
	};
}
