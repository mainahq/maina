/**
 * Two-stage PR Review.
 *
 * Stage 1 — Spec Compliance: checks diff against implementation plan tasks.
 * Stage 2 — Code Quality: checks added lines for common issues.
 *
 * Deterministic checks only — no AI calls.
 */

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
	mainaDir?: string; // enables AI review when provided
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

/**
 * Check if a file path matches any keywords from a task.
 */
function fileMatchesTask(file: string, taskKeywords: string[]): boolean {
	const fileLower = file.toLowerCase();
	return taskKeywords.some(
		(keyword) => keyword.length > 2 && fileLower.includes(keyword),
	);
}

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

	// Check each task has matching file changes
	const matchedFiles = new Set<string>();

	for (const task of tasks) {
		const keywords = extractKeywords(task);
		let taskCovered = false;

		for (const file of diffFiles) {
			if (fileMatchesTask(file, keywords)) {
				taskCovered = true;
				matchedFiles.add(file);
			}
		}

		if (!taskCovered) {
			findings.push({
				stage: "spec-compliance",
				severity: "warning",
				message: `Missing implementation for task: "${task}"`,
			});
		}
	}

	// Check for files not matching any task (over-building)
	for (const file of diffFiles) {
		if (!matchedFiles.has(file)) {
			findings.push({
				stage: "spec-compliance",
				severity: "info",
				message: `Possible over-building: "${file}" not mapped to any plan task`,
				file,
			});
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

	for (const { text, file, lineNum } of addedLines) {
		// Check for console.log
		if (/console\.log\s*\(/.test(text)) {
			findings.push({
				stage: "code-quality",
				severity: "warning",
				message: "console.log found in added code",
				file,
				line: lineNum,
			});
		}

		// Bare TODO without ticket ref — case-sensitive to skip identifiers like handleCreateTodo. Allows TODO(#123), TODO(JIRA-456)
		if (
			/\bTODO\b/.test(text) &&
			!/TODO\s*[(#]|TODO\s*\([A-Z]+-\d+\)/.test(text)
		) {
			findings.push({
				stage: "code-quality",
				severity: "warning",
				message: "TODO without ticket reference in added code",
				file,
				line: lineNum,
			});
		}

		// Check for empty function/method bodies
		if (
			/(?:function\s+\w+\s*\([^)]*\)|=>\s*)\s*\{\s*\}/.test(text) ||
			/\)\s*\{\s*\}/.test(text)
		) {
			findings.push({
				stage: "code-quality",
				severity: "warning",
				message: "Empty function body in added code",
				file,
				line: lineNum,
			});
		}

		// Check for very long lines (>120 chars)
		if (text.length > 120) {
			findings.push({
				stage: "code-quality",
				severity: "info",
				message: `Long line (${text.length} chars) in added code`,
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
	const stage1 = reviewSpecCompliance(
		options.diff,
		options.planContent ?? null,
	);

	if (!stage1.passed) {
		return {
			stage1,
			stage2: null,
			passed: false,
		};
	}

	const stage2 = options.mainaDir
		? await reviewCodeQualityWithAI(
				options.diff,
				options.conventions ?? null,
				options.mainaDir,
			)
		: reviewCodeQuality(options.diff, options.conventions ?? null);

	return {
		stage1,
		stage2,
		passed: stage1.passed && stage2.passed,
	};
}
