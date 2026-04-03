import { relative } from "node:path";
import type { Finding } from "../verify/diff-filter";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReviewSeverity = "critical" | "important" | "minor";

export interface ComprehensiveReviewFinding {
	severity: ReviewSeverity;
	category:
		| "quality"
		| "architecture"
		| "testing"
		| "requirements"
		| "security";
	file?: string;
	line?: number;
	issue: string;
	why: string;
	fix?: string;
}

export interface ComprehensiveReviewResult {
	strengths: string[];
	findings: ComprehensiveReviewFinding[];
	planAlignment: {
		tasksInPlan: number;
		tasksWithChanges: number;
		overBuilding: string[];
		missingImpl: string[];
	};
	architecture: {
		separationOfConcerns: boolean;
		errorHandling: boolean;
		typeSafety: boolean;
		notes: string[];
	};
	testing: {
		testFiles: number;
		implFiles: number;
		ratio: string;
		gaps: string[];
	};
	verdict: "ready" | "with-fixes" | "not-ready";
	verdictReason: string;
}

export interface ComprehensiveReviewOptions {
	diff: string;
	files: string[];
	repoRoot: string;
	planContent?: string | null;
	pipelineFindings?: Finding[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractAddedLines(
	diff: string,
): Array<{ file: string; line: number; content: string }> {
	const lines: Array<{ file: string; line: number; content: string }> = [];
	let currentFile = "";
	let lineNum = 0;

	for (const raw of diff.split("\n")) {
		if (raw.startsWith("+++ b/")) {
			currentFile = raw.slice(6);
			continue;
		}
		if (raw.startsWith("@@ ")) {
			const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
			lineNum = match ? Number.parseInt(match[1] ?? "0", 10) - 1 : 0;
			continue;
		}
		if (raw.startsWith("+") && !raw.startsWith("+++")) {
			lineNum++;
			lines.push({ file: currentFile, line: lineNum, content: raw.slice(1) });
		} else if (!raw.startsWith("-")) {
			lineNum++;
		}
	}
	return lines;
}

function extractTasksFromPlan(
	planContent: string,
): Array<{ id: string; description: string }> {
	const tasks: Array<{ id: string; description: string }> = [];
	const taskPattern = /- \[[ x]\]\s*(T\d+)[:\s]+(.*)/gi;
	let match: RegExpExecArray | null;
	match = taskPattern.exec(planContent);
	while (match !== null) {
		tasks.push({ id: match[1] ?? "", description: match[2] ?? "" });
		match = taskPattern.exec(planContent);
	}
	return tasks;
}

// ── Main Review ──────────────────────────────────────────────────────────────

export function comprehensiveReview(
	options: ComprehensiveReviewOptions,
): ComprehensiveReviewResult {
	const { diff, files, repoRoot, planContent, pipelineFindings } = options;
	const addedLines = extractAddedLines(diff);

	const strengths: string[] = [];
	const findings: ComprehensiveReviewFinding[] = [];

	// ── Quality checks ──────────────────────────────────────────────────

	// Check for Result<T,E> pattern usage (strength if present)
	const usesResult = addedLines.some(
		(l) => l.content.includes("Result<") || l.content.includes(": Result"),
	);
	if (usesResult) {
		strengths.push("Uses Result<T,E> error handling pattern (no throwing)");
	}

	// Check for console.log in production code
	for (const line of addedLines) {
		if (
			/console\.(log|warn|error|debug|info)\s*\(/.test(line.content) &&
			!line.file.includes(".test.") &&
			!line.file.includes("__tests__")
		) {
			findings.push({
				severity: "important",
				category: "quality",
				file: line.file,
				line: line.line,
				issue: `console.${/console\.(\w+)/.exec(line.content)?.[1]} in production code`,
				why: "Constitution forbids console.log in production. Breaks structured logging.",
				fix: "Remove or replace with proper logging/Result error handling",
			});
		}
	}

	// Check for bare TODO missing ticket reference
	for (const line of addedLines) {
		if (
			/\/\/\s*(?:TO)(?:DO)(?!\s*[(#[])/.test(line.content) &&
			!line.file.includes(".test.")
		) {
			findings.push({
				severity: "minor",
				category: "quality",
				file: line.file,
				line: line.line,
				issue: "TODO without ticket reference",
				why: "Untracked TODOs get forgotten. Link to a ticket for accountability.",
				fix: "Add ticket reference: // TODO(#123): description",
			});
		}
	}

	// Check for `any` type usage
	for (const line of addedLines) {
		if (/:\s*any\b|as\s+any\b/.test(line.content)) {
			findings.push({
				severity: "important",
				category: "quality",
				file: line.file,
				line: line.line,
				issue: "Usage of `any` type",
				why: "TypeScript strict mode is required. `any` bypasses all type checking.",
				fix: "Replace with proper type or `unknown`",
			});
		}
	}

	// Check for empty catch blocks
	for (const line of addedLines) {
		if (/catch\s*\{?\s*$/.test(line.content.trim())) {
			findings.push({
				severity: "minor",
				category: "quality",
				file: line.file,
				line: line.line,
				issue: "Empty catch block",
				why: "Swallowed errors hide bugs. At minimum, log or use Result pattern.",
			});
		}
	}

	// ── Pipeline findings (from maina verify) ───────────────────────────

	if (pipelineFindings && pipelineFindings.length > 0) {
		for (const f of pipelineFindings) {
			findings.push({
				severity: f.severity === "error" ? "critical" : "minor",
				category: "quality",
				file: f.file,
				line: f.line,
				issue: `[${f.tool}] ${f.message}`,
				why: `Caught by ${f.tool} verification tool`,
				fix: f.ruleId ? `Fix rule: ${f.ruleId}` : undefined,
			});
		}
	}

	// ── Architecture checks ─────────────────────────────────────────────

	const archNotes: string[] = [];
	let separationOk = true;
	let errorHandlingOk = true;
	const typeSafetyOk = true;

	// Check for cross-package imports
	for (const line of addedLines) {
		if (
			line.file.includes("packages/mcp/") &&
			line.content.includes("packages/cli/")
		) {
			separationOk = false;
			findings.push({
				severity: "important",
				category: "architecture",
				file: line.file,
				line: line.line,
				issue: "MCP package imports directly from CLI package",
				why: "Violates dependency direction. Both should depend on core, not on each other.",
				fix: "Move shared code to packages/core/",
			});
		}
	}

	// Check for throw statements (should use Result)
	const throwCount = addedLines.filter(
		(l) => /\bthrow\s/.test(l.content) && !l.file.includes(".test."),
	).length;
	if (throwCount > 0) {
		errorHandlingOk = false;
		archNotes.push(
			`${throwCount} throw statement(s) found — consider Result<T,E> pattern`,
		);
	}

	if (separationOk) {
		strengths.push("Clean separation of concerns across packages");
	}
	if (errorHandlingOk) {
		strengths.push("Consistent error handling (no throws in production)");
	}

	// ── Testing assessment ──────────────────────────────────────────────

	const testFiles = files.filter(
		(f) => f.includes(".test.") || f.includes("__tests__"),
	);
	const implFiles = files.filter(
		(f) =>
			!f.includes(".test.") &&
			!f.includes("__tests__") &&
			(f.endsWith(".ts") || f.endsWith(".tsx")),
	);
	const testGaps: string[] = [];

	// Check if impl files have corresponding test files
	for (const impl of implFiles) {
		const baseName = impl.replace(/\.tsx?$/, "");
		const hasTest = testFiles.some(
			(t) =>
				t.includes(baseName.split("/").pop() ?? "") || t.includes("__tests__"),
		);
		if (!hasTest) {
			testGaps.push(relative(repoRoot, impl));
		}
	}

	if (testFiles.length > 0) {
		strengths.push(`${testFiles.length} test file(s) with TDD approach`);
	}

	// ── Plan alignment ──────────────────────────────────────────────────

	let tasksInPlan = 0;
	let tasksWithChanges = 0;
	const overBuilding: string[] = [];
	const missingImpl: string[] = [];

	if (planContent) {
		const tasks = extractTasksFromPlan(planContent);
		tasksInPlan = tasks.length;

		const changedFileNames = files.map(
			(f) =>
				f
					.split("/")
					.pop()
					?.replace(/\.tsx?$/, "")
					.toLowerCase() ?? "",
		);

		for (const task of tasks) {
			const keywords = task.description.toLowerCase().split(/\s+/);
			const hasChange = keywords.some(
				(kw) => kw.length > 3 && changedFileNames.some((f) => f.includes(kw)),
			);
			if (hasChange) {
				tasksWithChanges++;
			} else {
				missingImpl.push(`${task.id}: ${task.description}`);
			}
		}

		if (tasksInPlan > 0 && tasksWithChanges === tasksInPlan) {
			strengths.push("All plan tasks have corresponding code changes");
		}
	}

	// ── Verdict ──────────────────────────────────────────────────────────

	const criticalCount = findings.filter(
		(f) => f.severity === "critical",
	).length;
	const importantCount = findings.filter(
		(f) => f.severity === "important",
	).length;

	let verdict: "ready" | "with-fixes" | "not-ready";
	let verdictReason: string;

	if (criticalCount > 0) {
		verdict = "not-ready";
		verdictReason = `${criticalCount} critical issue(s) must be fixed before merge`;
	} else if (importantCount > 0) {
		verdict = "with-fixes";
		verdictReason = `${importantCount} important issue(s) should be addressed`;
	} else {
		verdict = "ready";
		verdictReason = "No critical or important issues found";
	}

	return {
		strengths,
		findings,
		planAlignment: {
			tasksInPlan,
			tasksWithChanges,
			overBuilding,
			missingImpl,
		},
		architecture: {
			separationOfConcerns: separationOk,
			errorHandling: errorHandlingOk,
			typeSafety: typeSafetyOk,
			notes: archNotes,
		},
		testing: {
			testFiles: testFiles.length,
			implFiles: implFiles.length,
			ratio:
				implFiles.length > 0
					? `${((testFiles.length / implFiles.length) * 100).toFixed(0)}%`
					: "N/A",
			gaps: testGaps,
		},
		verdict,
		verdictReason,
	};
}
