/**
 * Cross-artifact consistency analyzer.
 *
 * Checks consistency across the three files in a feature directory:
 * - spec.md  — WHAT and WHY (user stories, acceptance criteria)
 * - plan.md  — HOW (architecture, tasks)
 * - tasks.md — Task breakdown (task list with status)
 *
 * Checks performed:
 * 1. Missing files
 * 2. Spec coverage — acceptance criteria addressed by tasks
 * 3. Orphaned tasks — tasks not mapping to any spec requirement
 * 4. WHAT/WHY vs HOW separation — implementation details in spec, user stories in plan
 * 5. Task status consistency — task counts match between plan.md and tasks.md
 * 6. Contradictions — conflicting information between plan.md and tasks.md
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";

export interface AnalysisReport {
	featureDir: string;
	findings: AnalysisFinding[];
	summary: { errors: number; warnings: number; info: number };
}

export interface AnalysisFinding {
	severity: "error" | "warning" | "info";
	category:
		| "missing-file"
		| "spec-coverage"
		| "orphaned-task"
		| "separation-violation"
		| "task-consistency"
		| "contradiction";
	message: string;
	file?: string;
	line?: number;
}

/**
 * Read a file if it exists, returning null if missing.
 */
function readOptionalFile(path: string): string | null {
	if (!existsSync(path)) return null;
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

/**
 * Extract acceptance criteria from spec content.
 * Returns individual criterion lines (trimmed, without leading `- ` or `- [ ] `).
 */
function extractAcceptanceCriteria(specContent: string): string[] {
	const lines = specContent.split("\n");
	const criteria: string[] = [];
	let inSection = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (/^##\s+acceptance\s+criteria/i.test(trimmed)) {
			inSection = true;
			continue;
		}

		if (inSection && /^##\s/.test(trimmed)) {
			break;
		}

		if (inSection && trimmed.startsWith("-")) {
			const content = trimmed.replace(/^-\s*(\[.\]\s*)?/, "").trim();
			if (content.length > 0) {
				criteria.push(content);
			}
		}
	}

	return criteria;
}

/**
 * Extract task lines from a markdown file's `## Tasks` section.
 * Returns objects with the task id (if present) and description.
 */
interface ParsedTask {
	id: string | null;
	description: string;
	fullLine: string;
}

function extractTasks(content: string): ParsedTask[] {
	const lines = content.split("\n");
	const tasks: ParsedTask[] = [];
	let inSection = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (/^##?\s+tasks/i.test(trimmed)) {
			inSection = true;
			continue;
		}

		if (inSection && /^##\s/.test(trimmed)) {
			break;
		}

		if (inSection && trimmed.startsWith("-")) {
			const content = trimmed.replace(/^-\s*(\[.\]\s*)?/, "").trim();
			if (content.length === 0) continue;

			const idMatch = content.match(/^(T\d+):\s*(.*)/i);
			if (idMatch) {
				tasks.push({
					id: idMatch[1]?.toUpperCase() ?? null,
					description: idMatch[2] ?? "",
					fullLine: content,
				});
			} else {
				tasks.push({ id: null, description: content, fullLine: content });
			}
		}
	}

	return tasks;
}

const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"are",
	"but",
	"not",
	"you",
	"all",
	"can",
	"has",
	"her",
	"was",
	"one",
	"our",
	"out",
	"with",
	"that",
	"this",
	"from",
	"have",
	"will",
	"should",
]);

/**
 * Extract significant keywords from a text (3+ chars, not stop words).
 */
function significantWords(text: string): string[] {
	return text
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length >= 3)
		.filter((w) => !STOP_WORDS.has(w));
}

/**
 * Check 1: Missing files.
 */
function checkMissingFiles(
	specContent: string | null,
	planContent: string | null,
	tasksContent: string | null,
): AnalysisFinding[] {
	const findings: AnalysisFinding[] = [];

	if (specContent === null) {
		findings.push({
			severity: "warning",
			category: "missing-file",
			message: "spec.md is missing — cannot verify WHAT/WHY requirements",
			file: "spec.md",
		});
	}

	if (planContent === null) {
		findings.push({
			severity: "warning",
			category: "missing-file",
			message: "plan.md is missing — cannot verify HOW implementation plan",
			file: "plan.md",
		});
	}

	if (tasksContent === null) {
		findings.push({
			severity: "info",
			category: "missing-file",
			message: "tasks.md is missing — task tracking not available",
			file: "tasks.md",
		});
	}

	return findings;
}

/**
 * Check 2: Spec coverage — every acceptance criterion should be addressed by at least one task.
 */
function checkSpecCoverage(
	specContent: string,
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): AnalysisFinding[] {
	const criteria = extractAcceptanceCriteria(specContent);
	const allTasks = [...planTasks, ...tasksTasks];
	const allTasksText = allTasks
		.map((t) => t.description.toLowerCase())
		.join(" ");

	const findings: AnalysisFinding[] = [];

	for (const criterion of criteria) {
		const keywords = significantWords(criterion);
		if (keywords.length === 0) continue;

		const matchedCount = keywords.filter((kw) =>
			allTasksText.includes(kw),
		).length;
		const coverage = matchedCount / keywords.length;

		if (coverage < 0.5) {
			findings.push({
				severity: "error",
				category: "spec-coverage",
				message: `Acceptance criterion not covered by any task: "${criterion}"`,
				file: "spec.md",
			});
		}
	}

	return findings;
}

/**
 * Check 3: Orphaned tasks — tasks that don't map to any requirement in spec.md.
 */
function checkOrphanedTasks(
	specContent: string,
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): AnalysisFinding[] {
	// Include full spec text for broad keyword matching
	const specLower = specContent.toLowerCase();
	const allSpecWords = new Set(significantWords(specLower));

	const findings: AnalysisFinding[] = [];

	// Deduplicate tasks by id to avoid checking the same task from both files
	const seen = new Set<string>();
	const allTasks = [...planTasks, ...tasksTasks];

	for (const task of allTasks) {
		const key = task.id ?? task.description;
		if (seen.has(key)) continue;
		seen.add(key);

		const taskWords = significantWords(task.description);
		if (taskWords.length === 0) continue;

		const matchedCount = taskWords.filter((w) => allSpecWords.has(w)).length;
		const coverage = matchedCount / taskWords.length;

		if (coverage < 0.3) {
			const source = planTasks.includes(task) ? "plan.md" : "tasks.md";
			findings.push({
				severity: "warning",
				category: "orphaned-task",
				message: `Task does not map to any spec requirement: "${task.fullLine}"`,
				file: source,
			});
		}
	}

	return findings;
}

/**
 * Implementation-detail keywords that should not appear in spec.md.
 */
const IMPL_KEYWORDS =
	/\b(JWT|REST|SQL|endpoint|database|schema|implementation|deploy)\b/i;

/**
 * User-story language that should not appear in plan.md.
 */
const STORY_PATTERN = /\bAs a (user|developer|admin|customer)\b/i;

/**
 * Check 4: WHAT/WHY vs HOW separation.
 */
function checkSeparation(
	specContent: string | null,
	planContent: string | null,
): AnalysisFinding[] {
	const findings: AnalysisFinding[] = [];

	if (specContent !== null) {
		const lines = specContent.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (IMPL_KEYWORDS.test(line)) {
				findings.push({
					severity: "warning",
					category: "separation-violation",
					message: `spec.md contains implementation detail: "${line.trim()}"`,
					file: "spec.md",
					line: i + 1,
				});
			}
		}
	}

	if (planContent !== null) {
		const lines = planContent.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (STORY_PATTERN.test(line)) {
				findings.push({
					severity: "warning",
					category: "separation-violation",
					message: `plan.md contains user story language: "${line.trim()}"`,
					file: "plan.md",
					line: i + 1,
				});
			}
		}
	}

	return findings;
}

/**
 * Check 5: Task status consistency — task counts match between plan.md and tasks.md.
 */
function checkTaskConsistency(
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): AnalysisFinding[] {
	const findings: AnalysisFinding[] = [];

	if (planTasks.length !== tasksTasks.length) {
		findings.push({
			severity: "warning",
			category: "task-consistency",
			message: `Task count mismatch: plan.md has ${planTasks.length} tasks, tasks.md has ${tasksTasks.length} tasks`,
		});
	}

	return findings;
}

/**
 * Check 6: Contradictions — conflicting task descriptions for the same T-number.
 */
function checkContradictions(
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): AnalysisFinding[] {
	const findings: AnalysisFinding[] = [];

	const planById = new Map<string, ParsedTask>();
	for (const task of planTasks) {
		if (task.id) {
			planById.set(task.id, task);
		}
	}

	for (const tasksTask of tasksTasks) {
		if (!tasksTask.id) continue;
		const planTask = planById.get(tasksTask.id);
		if (!planTask) continue;

		// Compare descriptions — use keyword overlap to detect contradictions
		const planWords = new Set(significantWords(planTask.description));
		const tasksWords = significantWords(tasksTask.description);

		if (tasksWords.length === 0 || planWords.size === 0) continue;

		const matchedCount = tasksWords.filter((w) => planWords.has(w)).length;
		const coverage = matchedCount / Math.max(tasksWords.length, planWords.size);

		if (coverage < 0.4) {
			findings.push({
				severity: "warning",
				category: "contradiction",
				message: `${tasksTask.id} has conflicting descriptions — plan.md: "${planTask.description}" vs tasks.md: "${tasksTask.description}"`,
			});
		}
	}

	return findings;
}

/**
 * Analyze cross-artifact consistency within a feature directory.
 *
 * Checks consistency across spec.md, plan.md, and tasks.md.
 * Returns an error Result only if the feature directory does not exist.
 * Missing individual files produce findings, not errors.
 */
export function analyze(featureDir: string): Result<AnalysisReport, string> {
	if (!existsSync(featureDir)) {
		return {
			ok: false,
			error: `Feature directory does not exist: ${featureDir}`,
		};
	}

	const specContent = readOptionalFile(join(featureDir, "spec.md"));
	const planContent = readOptionalFile(join(featureDir, "plan.md"));
	const tasksContent = readOptionalFile(join(featureDir, "tasks.md"));

	const findings: AnalysisFinding[] = [];

	// Check 1: Missing files
	findings.push(...checkMissingFiles(specContent, planContent, tasksContent));

	// Extract tasks from available files
	const planTasks = planContent ? extractTasks(planContent) : [];
	const tasksTasks = tasksContent ? extractTasks(tasksContent) : [];

	// Check 2: Spec coverage (requires spec + at least one task source)
	if (specContent && (planTasks.length > 0 || tasksTasks.length > 0)) {
		findings.push(...checkSpecCoverage(specContent, planTasks, tasksTasks));
	}

	// Check 3: Orphaned tasks (requires spec)
	if (specContent && (planTasks.length > 0 || tasksTasks.length > 0)) {
		findings.push(...checkOrphanedTasks(specContent, planTasks, tasksTasks));
	}

	// Check 4: WHAT/WHY vs HOW separation
	findings.push(...checkSeparation(specContent, planContent));

	// Check 5: Task consistency (requires both plan and tasks)
	if (planContent && tasksContent) {
		findings.push(...checkTaskConsistency(planTasks, tasksTasks));
	}

	// Check 6: Contradictions (requires both plan and tasks)
	if (planContent && tasksContent) {
		findings.push(...checkContradictions(planTasks, tasksTasks));
	}

	const summary = {
		errors: findings.filter((f) => f.severity === "error").length,
		warnings: findings.filter((f) => f.severity === "warning").length,
		info: findings.filter((f) => f.severity === "info").length,
	};

	return {
		ok: true,
		value: { featureDir, findings, summary },
	};
}
