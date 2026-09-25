/**
 * Plan-to-code traceability.
 *
 * Reads plan.md from a feature directory, extracts tasks (T001, T002, etc.),
 * and traces each task to matching test files, implementation files, and commits.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";
import type { ProcessPort } from "../ports/process";
import { systemProcess } from "../process/index";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskTrace {
	taskId: string;
	description: string;
	testFile: string | null;
	implFile: string | null;
	commitHash: string | null;
}

export interface TraceabilityReport {
	featureDir: string;
	tasks: TaskTrace[];
	coverage: {
		withTests: number;
		withImpl: number;
		withCommits: number;
		total: number;
	};
}

export interface TraceDeps {
	gitLog?: (repoRoot: string) => Promise<string>;
	/** Runs the default `git log`; the system adapter by default. */
	process?: ProcessPort;
}

// ── Task Parsing ─────────────────────────────────────────────────────────────

interface ParsedTask {
	id: string;
	description: string;
}

/**
 * Parse task lines from plan.md or tasks.md content.
 * Matches: - T001: description, - [ ] T001: description, - [x] T001: description,
 * and the tasks template's - [ ] **T-001** description.
 */
function parseTasks(content: string): ParsedTask[] {
	const lines = content.split("\n");
	const tasks: ParsedTask[] = [];
	const taskPattern = /^-\s+(?:\[[ x]\]\s+)?T(\d+):\s*(.+)$/;
	const templatePattern = /^-\s+(?:\[[ xX]\]\s+)?\*\*(T-\d+)\*\*\s*(.+)$/;

	for (const line of lines) {
		const trimmed = line.trim();
		const match = trimmed.match(taskPattern);
		if (match?.[1] && match[2]) {
			tasks.push({
				id: `T${match[1]}`,
				description: match[2].trim(),
			});
			continue;
		}
		const template = trimmed.match(templatePattern);
		if (template?.[1] && template[2]) {
			tasks.push({
				id: template[1],
				description: template[2].replace(/<!--.*?-->/g, "").trim(),
			});
		}
	}

	return tasks;
}

// ── File Search ──────────────────────────────────────────────────────────────

/**
 * Recursively collect file paths from a directory, skipping node_modules and hidden dirs.
 */
function collectFiles(dir: string): string[] {
	const results: string[] = [];

	if (!existsSync(dir)) return results;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return results;
	}

	for (const entry of entries) {
		if (entry.startsWith(".") || entry === "node_modules") continue;

		const fullPath = join(dir, entry);
		try {
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				results.push(...collectFiles(fullPath));
			} else if (stat.isFile()) {
				results.push(fullPath);
			}
		} catch {
			// Skip inaccessible files
		}
	}

	return results;
}

/**
 * Search for a test file containing the given task ID.
 */
function findTestFile(taskId: string, allFiles: string[]): string | null {
	const testFiles = allFiles.filter(
		(f) =>
			f.includes("__tests__") ||
			f.endsWith(".test.ts") ||
			f.endsWith(".test.tsx") ||
			f.endsWith(".test.js"),
	);

	for (const file of testFiles) {
		try {
			const content = readFileSync(file, "utf-8");
			if (content.includes(taskId)) {
				return file;
			}
		} catch {
			// Skip unreadable files
		}
	}

	return null;
}

/**
 * Search for an implementation file containing the task ID.
 * Excludes test files.
 */
function findImplFile(taskId: string, allFiles: string[]): string | null {
	const implFiles = allFiles.filter(
		(f) =>
			!f.includes("__tests__") &&
			!f.endsWith(".test.ts") &&
			!f.endsWith(".test.tsx") &&
			!f.endsWith(".test.js") &&
			(f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js")),
	);

	for (const file of implFiles) {
		try {
			const content = readFileSync(file, "utf-8");
			if (content.includes(taskId)) {
				return file;
			}
		} catch {
			// Skip unreadable files
		}
	}

	return null;
}

/**
 * Search git log output for a commit mentioning the task ID.
 * Returns the commit hash if found, null otherwise.
 */
function findCommit(taskId: string, gitLogOutput: string): string | null {
	const lines = gitLogOutput.split("\n");
	for (const line of lines) {
		if (line.includes(taskId)) {
			const hash = line.trim().split(" ")[0];
			if (hash && hash.length >= 7) {
				return hash;
			}
		}
	}

	return null;
}

// ── Default git log ──────────────────────────────────────────────────────────

async function defaultGitLog(
	repoRoot: string,
	processPort: ProcessPort,
): Promise<string> {
	const result = await processPort.spawn(["git", "log", "--oneline", "--all"], {
		cwd: repoRoot,
	});
	return result.ok ? result.value.stdout : "";
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Trace a feature's plan tasks to test files, implementation files, and commits.
 *
 * @param featureDir - Path to the feature directory (containing plan.md)
 * @param repoRoot - Path to the repository root (for file and commit search)
 * @param deps - Optional dependency overrides (e.g., mock git log)
 */
export async function traceFeature(
	featureDir: string,
	repoRoot: string,
	deps?: TraceDeps,
): Promise<Result<TraceabilityReport, string>> {
	if (!existsSync(featureDir)) {
		return {
			ok: false,
			error: `Feature directory does not exist: ${featureDir}`,
		};
	}

	const planPath = join(featureDir, "plan.md");
	const tasksPath = join(featureDir, "tasks.md");
	const sources = [planPath, tasksPath].filter((p) => existsSync(p));
	if (sources.length === 0) {
		return {
			ok: false,
			error: `plan.md not found at ${planPath} (and no tasks.md beside it)`,
		};
	}

	// plan.md first; a task id listed in both files is traced once.
	const parsedTasks: ParsedTask[] = [];
	for (const path of sources) {
		for (const task of parseTasks(readFileSync(path, "utf-8"))) {
			if (!parsedTasks.some((t) => t.id === task.id)) parsedTasks.push(task);
		}
	}

	// Collect all files from repo root
	const allFiles = collectFiles(repoRoot);

	// Get git log
	const gitLogFn =
		deps?.gitLog ??
		((root: string) => defaultGitLog(root, deps?.process ?? systemProcess));
	let gitLogOutput = "";
	try {
		gitLogOutput = await gitLogFn(repoRoot);
	} catch {
		// Git log failure should not block traceability
	}

	// Build task traces
	const tasks: TaskTrace[] = parsedTasks.map((task) => ({
		taskId: task.id,
		description: task.description,
		testFile: findTestFile(task.id, allFiles),
		implFile: findImplFile(task.id, allFiles),
		commitHash: findCommit(task.id, gitLogOutput),
	}));

	const coverage = {
		withTests: tasks.filter((t) => t.testFile !== null).length,
		withImpl: tasks.filter((t) => t.implFile !== null).length,
		withCommits: tasks.filter((t) => t.commitHash !== null).length,
		total: tasks.length,
	};

	return {
		ok: true,
		value: {
			featureDir,
			tasks,
			coverage,
		},
	};
}
