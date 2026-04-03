/**
 * Diff-Only Filter — Reviewdog pattern for the Verify Engine.
 *
 * Filters findings to only changed lines via git diff. Pre-existing issues
 * on unchanged lines are counted but hidden, so developers only see problems
 * they introduced. This eliminates noise from legacy code.
 */

import { getDiff } from "../git/index";

// ─── Types ────────────────────────────────────────────────────────────────

export interface Finding {
	tool: string;
	file: string;
	line: number;
	column?: number;
	message: string;
	severity: "error" | "warning" | "info";
	ruleId?: string;
}

export interface DiffFilterResult {
	shown: Finding[];
	hidden: number;
}

// ─── Diff Parsing ─────────────────────────────────────────────────────────

/**
 * Parse unified diff output to extract changed line numbers per file.
 *
 * Returns a Map from file path to Set of changed (added/modified) line numbers
 * in the new version of the file. Only `+` lines are tracked — deletions don't
 * have a line number in the new file.
 */
export function parseChangedLines(diff: string): Map<string, Set<number>> {
	const result = new Map<string, Set<number>>();

	if (!diff.trim()) {
		return result;
	}

	const lines = diff.split("\n");
	let currentFile: string | null = null;
	let newLineNum = 0;

	for (const line of lines) {
		// Detect file header: +++ b/path/to/file
		if (line.startsWith("+++ ")) {
			const filePath = line.slice(4);
			if (filePath === "/dev/null") {
				currentFile = null;
				continue;
			}
			// Strip the "b/" prefix that git uses
			currentFile = filePath.startsWith("b/") ? filePath.slice(2) : filePath;
			if (!result.has(currentFile)) {
				result.set(currentFile, new Set());
			}
			continue;
		}

		// Skip --- header (old file)
		if (line.startsWith("--- ")) {
			continue;
		}

		// Parse hunk header: @@ -old,count +new,count @@
		const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunkMatch) {
			newLineNum = Number.parseInt(hunkMatch[1] ?? "0", 10);
			continue;
		}

		// Skip diff metadata lines
		if (
			line.startsWith("diff --git") ||
			line.startsWith("index ") ||
			line.startsWith("new file mode") ||
			line.startsWith("deleted file mode") ||
			line.startsWith("old mode") ||
			line.startsWith("new mode") ||
			line.startsWith("similarity index") ||
			line.startsWith("rename from") ||
			line.startsWith("rename to") ||
			line.startsWith("Binary files")
		) {
			continue;
		}

		if (currentFile === null) {
			continue;
		}

		// Added line: track it
		if (line.startsWith("+")) {
			result.get(currentFile)?.add(newLineNum);
			newLineNum++;
			continue;
		}

		// Deleted line: skip (no line number in new file)
		if (line.startsWith("-")) {
			continue;
		}

		// Context line (space prefix or empty within hunk): advance line counter
		if (line.startsWith(" ") || line === "") {
			newLineNum++;
			continue;
		}

		// No-newline-at-end-of-file marker
		if (line.startsWith("\\")) {
			continue;
		}

		// Any other line within a hunk — advance counter as context
		newLineNum++;
	}

	return result;
}

// ─── Filter Logic ─────────────────────────────────────────────────────────

/**
 * Filter findings against a pre-computed changed-lines map.
 * Findings on changed lines are shown; all others are hidden.
 *
 * Exported for testing without needing to invoke git.
 */
export function filterByDiffWithMap(
	findings: Finding[],
	changedLines: Map<string, Set<number>>,
): DiffFilterResult {
	const shown: Finding[] = [];
	let hidden = 0;

	for (const finding of findings) {
		const fileChanges = changedLines.get(finding.file);
		if (fileChanges?.has(finding.line)) {
			shown.push(finding);
		} else {
			hidden++;
		}
	}

	return { shown, hidden };
}

/**
 * Filter findings to only those on lines changed relative to a base branch.
 *
 * Uses `git diff <baseBranch>` to determine which lines are new/modified,
 * then partitions findings into shown (on changed lines) and hidden
 * (on unchanged lines, i.e. pre-existing issues).
 *
 * @param findings - All findings from verification tools
 * @param baseBranch - The branch to diff against (defaults to "main")
 * @param cwd - Working directory for git commands
 * @returns Partitioned findings with hidden count
 */
export async function filterByDiff(
	findings: Finding[],
	baseBranch?: string,
	cwd?: string,
): Promise<DiffFilterResult> {
	const base = baseBranch ?? "main";

	// Get the diff against the base branch
	const diff = await getDiff(base, undefined, cwd);

	// If no diff (e.g. on the base branch itself, or git error),
	// show all findings as a safe fallback
	if (!diff.trim()) {
		return { shown: findings, hidden: 0 };
	}

	const changedLines = parseChangedLines(diff);
	return filterByDiffWithMap(findings, changedLines);
}
