/**
 * Cross-artifact consistency analyzer.
 *
 * Checks consistency across the three files in a feature directory:
 * - spec.md  — WHAT and WHY (user stories, acceptance criteria)
 * - plan.md  — HOW (architecture, tasks)
 * - tasks.md — Task breakdown (task list with status)
 *
 * Checks performed (the six `ANALYSIS_CATEGORIES`):
 * 1. Missing files
 * 2. Spec coverage — acceptance criteria addressed by tasks
 * 3. Orphaned tasks — tasks not mapping to any spec requirement
 * 4. WHAT/WHY vs HOW separation — implementation details in spec, user stories in plan
 * 5. Task status consistency — task counts match between plan.md and tasks.md
 * 6. Contradictions — conflicting information between plan.md and tasks.md
 *
 * `analyzeArtifacts` (FR-SPEC-3) calibrates each finding on the confidence
 * `decide` gave it: a finding under its decision type's policy threshold is
 * downgraded one severity level, and an error at or over the threshold
 * blocks. `analyze(featureDir)` reads the files and reports the uncalibrated
 * findings.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";
import {
	type DecidePorts,
	defaultDecidePorts,
	type JudgedAnswer,
	judgeEach,
} from "../decide/decide";
import type { DecisionType } from "../policy/schema";
import { extractAcceptanceCriteria, STOP_WORDS } from "../utils";

export const ANALYSIS_CATEGORIES = [
	"missing-file",
	"spec-coverage",
	"orphaned-task",
	"separation-violation",
	"task-consistency",
	"contradiction",
] as const;

export type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number];
export type AnalysisSeverity = "error" | "warning" | "info";

export interface AnalysisReport {
	featureDir: string;
	findings: AnalysisFinding[];
	summary: { errors: number; warnings: number; info: number };
}

export interface AnalysisFinding {
	severity: AnalysisSeverity;
	category: AnalysisCategory;
	message: string;
	file?: string;
	line?: number;
}

/** A finding with its severity calibrated against the policy. */
export type CalibratedFinding = Readonly<
	AnalysisFinding & {
		/** The severity before calibration. */
		baseSeverity: AnalysisSeverity;
		/** `decide`'s confidence in the finding; 1 for exact checks. */
		confidence: number;
		/** The policy's confidence threshold for the finding's decision type. */
		threshold: number;
		/** An error at or over the threshold. */
		blocking: boolean;
	}
>;

export type CalibratedReport = Readonly<{
	findings: readonly CalibratedFinding[];
	summary: Readonly<{ errors: number; warnings: number; info: number }>;
	/** Any finding blocks. */
	blocking: boolean;
}>;

/** An uncalibrated finding plus what calibration needs. */
type JudgedFinding = AnalysisFinding & {
	confidence: number;
	/** The decision type that produced it; absent for exact checks. */
	decisionType?: DecisionType;
};

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
 * Extract task lines from a markdown file's `## Tasks` (or the tasks
 * template's `## Phases`) section.
 * Returns objects with the task id (if present) and description.
 */
interface ParsedTask {
	id: string | null;
	description: string;
	fullLine: string;
}

/** `T001: text` or the template's `**T-001** text`. */
function parseTaskContent(taskContent: string): ParsedTask {
	const idMatch =
		taskContent.match(/^(T\d+):\s*(.*)/i) ??
		taskContent.match(/^\*\*(T-\d+)\*\*\s*(.*)/i);
	if (idMatch) {
		return {
			id: idMatch[1]?.toUpperCase() ?? null,
			description: idMatch[2] ?? "",
			fullLine: taskContent,
		};
	}
	return { id: null, description: taskContent, fullLine: taskContent };
}

function extractTasks(content: string): ParsedTask[] {
	const lines = content.split("\n");
	const tasks: ParsedTask[] = [];
	let inSection = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (/^##?\s+(tasks|phases)/i.test(trimmed)) {
			inSection = true;
			continue;
		}

		if (
			inSection &&
			/^##\s/.test(trimmed) &&
			!/^###\s+(T\d+):/i.test(trimmed)
		) {
			break;
		}

		// Support checklist format: - [ ] T001: description
		if (inSection && trimmed.startsWith("-")) {
			const taskContent = trimmed.replace(/^-\s*(\[.\]\s*)?/, "").trim();
			if (taskContent.length === 0) continue;
			tasks.push(parseTaskContent(taskContent));
		}

		// Support heading format: ### T001: description
		if (!inSection || !trimmed.startsWith("-")) {
			const headingMatch = trimmed.match(/^###\s+(T\d+):\s*(.*)/i);
			if (headingMatch) {
				const id = headingMatch[1]?.toUpperCase() ?? null;
				// Avoid duplicates if already found in ## Tasks checklist
				if (!tasks.some((t) => t.id === id)) {
					tasks.push({
						id,
						description: headingMatch[2] ?? "",
						fullLine: `${id}: ${headingMatch[2] ?? ""}`,
					});
				}
			}
		}
	}

	return tasks;
}

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
): JudgedFinding[] {
	const findings: JudgedFinding[] = [];

	if (specContent === null) {
		findings.push({
			severity: "warning",
			category: "missing-file",
			message: "spec.md is missing — cannot verify WHAT/WHY requirements",
			file: "spec.md",
			confidence: 1,
		});
	}

	if (planContent === null) {
		findings.push({
			severity: "warning",
			category: "missing-file",
			message: "plan.md is missing — cannot verify HOW implementation plan",
			file: "plan.md",
			confidence: 1,
		});
	}

	if (tasksContent === null) {
		findings.push({
			severity: "info",
			category: "missing-file",
			message: "tasks.md is missing — task tracking not available",
			file: "tasks.md",
			confidence: 1,
		});
	}

	return findings;
}

/** The candidates `judged` flagged (`answer === want`), with their confidence. */
function flagged<T>(
	candidates: readonly T[],
	judged: readonly JudgedAnswer[],
	want: boolean,
): Array<{ item: T; confidence: number }> {
	return candidates.flatMap((item, i) => {
		const j = judged[i];
		return j !== undefined && j.answer === want
			? [{ item, confidence: j.confidence }]
			: [];
	});
}

/**
 * Check 2: Spec coverage — every acceptance criterion should be addressed by at least one task.
 */
function checkSpecCoverage(
	ports: DecidePorts,
	specContent: string,
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): JudgedFinding[] {
	const criteria = extractAcceptanceCriteria(specContent);
	const allTasks = [...planTasks, ...tasksTasks];
	const allTasksText = allTasks
		.map((t) => t.description.toLowerCase())
		.join(" ");

	const counted: Array<{ criterion: string; matched: number; total: number }> =
		[];
	for (const criterion of criteria) {
		const keywords = significantWords(criterion);
		if (keywords.length === 0) continue;
		const matched = keywords.filter((kw) => allTasksText.includes(kw)).length;
		counted.push({ criterion, matched, total: keywords.length });
	}

	const covered = judgeEach(ports, {
		type: "spec.coverage",
		check: "criterion",
		trusted: counted.map(({ matched, total }) => ({ matched, total })),
		untrusted: counted.map(({ criterion }) => ({ text: criterion })),
	});
	return flagged(counted, covered, false).map(({ item, confidence }) => ({
		severity: "error",
		category: "spec-coverage",
		message: `Acceptance criterion not covered by any task: "${item.criterion}"`,
		file: "spec.md",
		confidence,
		decisionType: "spec.coverage",
	}));
}

/**
 * Check 3: Orphaned tasks — tasks that don't map to any requirement in spec.md.
 */
function checkOrphanedTasks(
	ports: DecidePorts,
	specContent: string,
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): JudgedFinding[] {
	// Include full spec text for broad keyword matching
	const specLower = specContent.toLowerCase();
	const allSpecWords = new Set(significantWords(specLower));

	const candidates: Array<{
		task: ParsedTask;
		hasSpecRef: boolean;
		matched: number;
		total: number;
	}> = [];

	// Deduplicate tasks by id to avoid checking the same task from both files
	const seen = new Set<string>();
	const allTasks = [...planTasks, ...tasksTasks];

	for (const task of allTasks) {
		const key = task.id ?? task.description;
		if (seen.has(key)) continue;
		seen.add(key);

		// Check if task references requirement IDs (R1, AC1, etc.) that appear in spec
		const refPattern = /\b(?:R\d+|AC\d+)\b/gi;
		const taskRefs = task.fullLine.match(refPattern) ?? [];
		const hasSpecRef = taskRefs.some((ref) =>
			specLower.includes(ref.toLowerCase()),
		);
		const taskWords = significantWords(task.description);
		// A task that references a spec requirement is never orphaned; one
		// with no significant words cannot be judged.
		if (!hasSpecRef && taskWords.length === 0) continue;

		const matched = taskWords.filter((w) => allSpecWords.has(w)).length;
		candidates.push({ task, hasSpecRef, matched, total: taskWords.length });
	}

	const orphaned = judgeEach(ports, {
		type: "spec.orphan",
		check: "task",
		trusted: candidates.map(({ hasSpecRef, matched, total }) => ({
			hasSpecRef,
			matched,
			total,
		})),
		untrusted: candidates.map(({ task }) => ({ text: task.fullLine })),
	});
	return flagged(candidates, orphaned, true).map(({ item, confidence }) => ({
		severity: "warning",
		category: "orphaned-task",
		message: `Task does not map to any spec requirement: "${item.task.fullLine}"`,
		file: planTasks.includes(item.task) ? "plan.md" : "tasks.md",
		confidence,
		decisionType: "spec.orphan",
	}));
}

/**
 * Check 4: WHAT/WHY vs HOW separation. Each spec.md line is asked whether it
 * leaks implementation detail, each plan.md line whether it holds
 * user-story language (`spec.impl_leak`).
 */
function checkSeparation(
	ports: DecidePorts,
	specContent: string | null,
	planContent: string | null,
): JudgedFinding[] {
	const sides = [
		{
			content: specContent,
			check: "impl-in-spec",
			file: "spec.md",
			describe: (line: string) =>
				`spec.md contains implementation detail: "${line}"`,
		},
		{
			content: planContent,
			check: "story-in-plan",
			file: "plan.md",
			describe: (line: string) =>
				`plan.md contains user story language: "${line}"`,
		},
	] as const;

	return sides.flatMap(({ content, check, file, describe }) => {
		if (content === null) return [];
		const lines = content.split("\n").map((text, i) => ({ text, line: i + 1 }));
		const leaks = judgeEach(ports, {
			type: "spec.impl_leak",
			check,
			untrusted: lines.map(({ text }) => ({ text })),
		});
		return flagged(lines, leaks, true).map(
			({ item, confidence }): JudgedFinding => ({
				severity: "warning",
				category: "separation-violation",
				message: describe(item.text.trim()),
				file,
				line: item.line,
				confidence,
				decisionType: "spec.impl_leak",
			}),
		);
	});
}

/**
 * Check 5: Task status consistency — task counts match between plan.md and tasks.md.
 */
function checkTaskConsistency(
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): JudgedFinding[] {
	if (planTasks.length === tasksTasks.length) return [];
	return [
		{
			severity: "warning",
			category: "task-consistency",
			message: `Task count mismatch: plan.md has ${planTasks.length} tasks, tasks.md has ${tasksTasks.length} tasks`,
			confidence: 1,
		},
	];
}

/**
 * Check 6: Contradictions — conflicting task descriptions for the same T-number.
 */
function checkContradictions(
	ports: DecidePorts,
	planTasks: ParsedTask[],
	tasksTasks: ParsedTask[],
): JudgedFinding[] {
	const planById = new Map<string, ParsedTask>();
	for (const task of planTasks) {
		if (task.id) {
			planById.set(task.id, task);
		}
	}

	const pairs: Array<{
		id: string;
		plan: string;
		tasks: string;
		matched: number;
		total: number;
	}> = [];
	for (const tasksTask of tasksTasks) {
		if (!tasksTask.id) continue;
		const planTask = planById.get(tasksTask.id);
		if (!planTask) continue;

		// Compare descriptions — use keyword overlap to detect contradictions
		const planWords = new Set(significantWords(planTask.description));
		const tasksWords = significantWords(tasksTask.description);

		if (tasksWords.length === 0 || planWords.size === 0) continue;

		pairs.push({
			id: tasksTask.id,
			plan: planTask.description,
			tasks: tasksTask.description,
			matched: tasksWords.filter((w) => planWords.has(w)).length,
			total: Math.max(tasksWords.length, planWords.size),
		});
	}

	const contradicts = judgeEach(ports, {
		type: "spec.contradiction",
		check: "task",
		trusted: pairs.map(({ matched, total }) => ({ matched, total })),
		untrusted: pairs.map(({ plan, tasks }) => ({ plan, tasks })),
	});
	return flagged(pairs, contradicts, true).map(({ item, confidence }) => ({
		severity: "warning",
		category: "contradiction",
		message: `${item.id} has conflicting descriptions — plan.md: "${item.plan}" vs tasks.md: "${item.tasks}"`,
		confidence,
		decisionType: "spec.contradiction",
	}));
}

/** Every check's findings, in check order. */
function judgeArtifacts(
	ports: DecidePorts,
	specContent: string | null,
	planContent: string | null,
	tasksContent: string | null,
): JudgedFinding[] {
	const planTasks = planContent ? extractTasks(planContent) : [];
	const tasksTasks = tasksContent ? extractTasks(tasksContent) : [];
	const hasTasks = planTasks.length > 0 || tasksTasks.length > 0;
	const bothTaskFiles = Boolean(planContent && tasksContent);

	return [
		...checkMissingFiles(specContent, planContent, tasksContent),
		...(specContent && hasTasks
			? checkSpecCoverage(ports, specContent, planTasks, tasksTasks)
			: []),
		...(specContent && hasTasks
			? checkOrphanedTasks(ports, specContent, planTasks, tasksTasks)
			: []),
		...checkSeparation(ports, specContent, planContent),
		...(bothTaskFiles ? checkTaskConsistency(planTasks, tasksTasks) : []),
		...(bothTaskFiles ? checkContradictions(ports, planTasks, tasksTasks) : []),
	];
}

function summarize(findings: readonly AnalysisFinding[]) {
	return {
		errors: findings.filter((f) => f.severity === "error").length,
		warnings: findings.filter((f) => f.severity === "warning").length,
		info: findings.filter((f) => f.severity === "info").length,
	};
}

const DOWNGRADE: Readonly<Record<AnalysisSeverity, AnalysisSeverity>> = {
	error: "warning",
	warning: "info",
	info: "info",
};

/**
 * Analyzes spec, plan and tasks text (`null` for a missing file) and
 * calibrates every finding: under its decision type's policy confidence
 * threshold it drops one severity level; an error at or over the threshold
 * blocks. Exact checks (missing files, task counts) have confidence 1 and
 * threshold 0.
 */
export function analyzeArtifacts(
	spec: string | null,
	plan: string | null,
	tasks: string | null,
	ports: DecidePorts = defaultDecidePorts,
): CalibratedReport {
	const findings = judgeArtifacts(ports, spec, plan, tasks).map(
		({ confidence, decisionType, ...finding }): CalibratedFinding => {
			const threshold =
				decisionType === undefined
					? 0
					: ports.policy.decisions[decisionType].thresholds.confidence;
			const severity =
				confidence >= threshold
					? finding.severity
					: DOWNGRADE[finding.severity];
			return {
				...finding,
				severity,
				baseSeverity: finding.severity,
				confidence,
				threshold,
				blocking: severity === "error",
			};
		},
	);
	return {
		findings,
		summary: summarize(findings),
		blocking: findings.some((f) => f.blocking),
	};
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

	const findings = judgeArtifacts(
		defaultDecidePorts,
		readOptionalFile(join(featureDir, "spec.md")),
		readOptionalFile(join(featureDir, "plan.md")),
		readOptionalFile(join(featureDir, "tasks.md")),
	).map(({ confidence: _c, decisionType: _t, ...finding }) => finding);

	return {
		ok: true,
		value: { featureDir, findings, summary: summarize(findings) },
	};
}
