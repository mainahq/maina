/**
 * Deterministic plan verification checklist.
 *
 * Verifies a plan.md against its spec.md without any AI involvement:
 * 1. Spec criterion coverage — every acceptance criterion has a matching task
 * 2. No TODO/TBD/PLACEHOLDER/FIXME markers — [NEEDS CLARIFICATION] is allowed
 * 3. Function/type name consistency — backtick-quoted identifiers are consistent
 * 4. Test-first ordering — test tasks appear before implementation tasks
 */

import { existsSync, readFileSync } from "node:fs";
import type { Result } from "../db/index";

export interface VerificationReport {
	passed: boolean;
	checks: CheckResult[];
}

export interface CheckResult {
	name: string;
	passed: boolean;
	details: string[];
}

/**
 * Extract the content under `## Acceptance criteria` from a spec file.
 * Returns individual criterion lines (trimmed, without leading `- ` or `- [ ] `).
 */
function extractAcceptanceCriteria(specContent: string): string[] {
	const lines = specContent.split("\n");
	const criteria: string[] = [];
	let inSection = false;

	for (const line of lines) {
		const trimmed = line.trim();

		// Detect start of acceptance criteria section (case-insensitive)
		if (/^##\s+acceptance\s+criteria/i.test(trimmed)) {
			inSection = true;
			continue;
		}

		// Stop at next heading
		if (inSection && /^##\s/.test(trimmed)) {
			break;
		}

		if (inSection && trimmed.startsWith("-")) {
			// Strip leading `- `, `- [ ] `, `- [x] `
			const content = trimmed.replace(/^-\s*(\[.\]\s*)?/, "").trim();
			if (content.length > 0) {
				criteria.push(content);
			}
		}
	}

	return criteria;
}

/**
 * Extract task descriptions from a plan file's `## Tasks` section.
 * Returns the full task line text (after the leading `- ` and optional task id).
 */
function extractTasks(planContent: string): string[] {
	const lines = planContent.split("\n");
	const tasks: string[] = [];
	let inSection = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (/^##\s+tasks/i.test(trimmed)) {
			inSection = true;
			continue;
		}

		if (inSection && /^##\s/.test(trimmed)) {
			break;
		}

		if (inSection && trimmed.startsWith("-")) {
			const content = trimmed.replace(/^-\s*(\[.\]\s*)?/, "").trim();
			if (content.length > 0) {
				tasks.push(content);
			}
		}
	}

	return tasks;
}

/**
 * Check 1: Spec criterion coverage.
 *
 * Every acceptance criterion keyword should appear in at least one task.
 * We extract significant words (3+ chars, lowercase) from each criterion
 * and check that the majority appear in the combined task text.
 */
function checkSpecCoverage(
	specContent: string,
	planContent: string,
): CheckResult {
	const criteria = extractAcceptanceCriteria(specContent);
	const tasks = extractTasks(planContent);
	const allTasksText = tasks.join(" ").toLowerCase();

	const details: string[] = [];

	for (const criterion of criteria) {
		const keywords = criterion
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length >= 3)
			// Filter out very common words that don't indicate coverage
			.filter(
				(w) =>
					![
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
					].includes(w),
			);

		if (keywords.length === 0) continue;

		const matchedCount = keywords.filter((kw) =>
			allTasksText.includes(kw),
		).length;
		const coverage = matchedCount / keywords.length;

		// Require at least 50% keyword coverage for a criterion to be considered covered
		if (coverage < 0.5) {
			details.push(`Criterion not covered in tasks: "${criterion}"`);
		}
	}

	return {
		name: "spec-coverage",
		passed: details.length === 0,
		details,
	};
}

/**
 * Check 2: No TODO/TBD/PLACEHOLDER/FIXME markers.
 *
 * Scans plan content for forbidden markers (case-insensitive).
 * [NEEDS CLARIFICATION] is explicitly allowed and excluded.
 */
function checkNoPlaceholders(planContent: string): CheckResult {
	const lines = planContent.split("\n");
	const details: string[] = [];

	// Remove [NEEDS CLARIFICATION] before scanning so it doesn't trigger
	const forbiddenPattern = /\b(TODO|TBD|PLACEHOLDER|FIXME)\b/i;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		// Strip out [NEEDS CLARIFICATION] markers before checking
		const sanitized = line.replace(/\[NEEDS CLARIFICATION\]/gi, "");
		const match = forbiddenPattern.exec(sanitized);
		if (match) {
			const marker = match[1] ?? "";
			details.push(
				`Line ${i + 1}: Found "${marker.toUpperCase()}" marker — "${line.trim()}"`,
			);
		}
	}

	return {
		name: "no-placeholders",
		passed: details.length === 0,
		details,
	};
}

/**
 * Check 3: Function/type name consistency.
 *
 * Extract all backtick-quoted identifiers from the plan's Tasks section.
 * Identifiers used multiple times should be spelled identically.
 * This check verifies no identifier appears with inconsistent casing
 * (e.g., `createUser` vs `CreateUser` would be flagged).
 */
function checkNameConsistency(planContent: string): CheckResult {
	const tasks = extractTasks(planContent);
	const details: string[] = [];

	// Extract all backtick-quoted identifiers from task lines
	const identifierOccurrences = new Map<string, string[]>();

	for (const task of tasks) {
		const matches = task.matchAll(/`([^`]+)`/g);
		for (const match of matches) {
			const name = match[1];
			if (!name) continue;
			const lower = name.toLowerCase();
			if (!identifierOccurrences.has(lower)) {
				identifierOccurrences.set(lower, []);
			}
			identifierOccurrences.get(lower)?.push(name);
		}
	}

	// Check for inconsistent casing among identifiers with the same lowercase form
	for (const [lower, occurrences] of identifierOccurrences) {
		if (occurrences.length < 2) continue;
		const canonical = occurrences[0];
		for (let i = 1; i < occurrences.length; i++) {
			if (occurrences[i] !== canonical) {
				details.push(
					`Inconsistent identifier: "${canonical}" vs "${occurrences[i]}" (lowercase: "${lower}")`,
				);
			}
		}
	}

	return {
		name: "name-consistency",
		passed: details.length === 0,
		details,
	};
}

/**
 * Check 4: Test-first ordering.
 *
 * If a task mentions "test" in its description, it should appear before
 * corresponding implementation tasks for the same component.
 *
 * We identify component keywords (significant words shared between test and
 * implementation tasks) and verify test tasks come first.
 */
function checkTestFirstOrdering(planContent: string): CheckResult {
	const tasks = extractTasks(planContent);
	const details: string[] = [];

	interface TaskInfo {
		index: number;
		text: string;
		isTest: boolean;
		keywords: Set<string>;
	}

	const stopWords = new Set([
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
		"write",
		"test",
		"tests",
		"implement",
		"implementation",
		"create",
		"add",
		"update",
	]);

	const taskInfos: TaskInfo[] = tasks.map((text, index) => {
		const isTest = /\btest/i.test(text);
		const keywords = new Set(
			text
				.toLowerCase()
				.replace(/`[^`]+`/g, "") // Remove backtick identifiers
				.replace(/^T\d+:\s*/i, "") // Remove task ids
				.split(/\s+/)
				.filter((w) => w.length >= 3)
				.filter((w) => !stopWords.has(w)),
		);
		return { index, text, isTest, keywords };
	});

	const testTasks = taskInfos.filter((t) => t.isTest);
	const implTasks = taskInfos.filter((t) => !t.isTest);

	for (const testTask of testTasks) {
		// Find implementation tasks that share keywords with this test task
		for (const implTask of implTasks) {
			const shared = [...testTask.keywords].filter((kw) =>
				implTask.keywords.has(kw),
			);
			// If they share significant keywords, the test should come first
			if (shared.length > 0 && testTask.index > implTask.index) {
				details.push(
					`Test task appears after implementation: "${testTask.text}" (task ${testTask.index + 1}) should come before "${implTask.text}" (task ${implTask.index + 1}) [shared: ${shared.join(", ")}]`,
				);
			}
		}
	}

	return {
		name: "test-first",
		passed: details.length === 0,
		details,
	};
}

/**
 * Verify a plan.md against its spec.md using deterministic checks.
 *
 * Runs four checks:
 * 1. spec-coverage — acceptance criteria covered by tasks
 * 2. no-placeholders — no TODO/TBD/PLACEHOLDER/FIXME markers
 * 3. name-consistency — backtick identifiers are consistent
 * 4. test-first — test tasks appear before implementation tasks
 *
 * Returns a Result with VerificationReport on success, or an error string
 * if the files cannot be read.
 */
export function verifyPlan(
	planPath: string,
	specPath: string,
): Result<VerificationReport, string> {
	// Validate files exist
	if (!existsSync(specPath)) {
		return {
			ok: false,
			error: `Spec file not found: ${specPath}`,
		};
	}

	if (!existsSync(planPath)) {
		return {
			ok: false,
			error: `Plan file not found: ${planPath}`,
		};
	}

	let specContent: string;
	let planContent: string;

	try {
		specContent = readFileSync(specPath, "utf-8");
	} catch (e) {
		return {
			ok: false,
			error: `Failed to read spec file: ${e instanceof Error ? e.message : String(e)}`,
		};
	}

	try {
		planContent = readFileSync(planPath, "utf-8");
	} catch (e) {
		return {
			ok: false,
			error: `Failed to read plan file: ${e instanceof Error ? e.message : String(e)}`,
		};
	}

	const checks: CheckResult[] = [
		checkSpecCoverage(specContent, planContent),
		checkNoPlaceholders(planContent),
		checkNameConsistency(planContent),
		checkTestFirstOrdering(planContent),
	];

	const passed = checks.every((c) => c.passed);

	return {
		ok: true,
		value: { passed, checks },
	};
}
