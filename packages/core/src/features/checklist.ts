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
import { decideEach, defaultDecidePorts } from "../decide/decide";
import { ID_PATTERN } from "../decide/log/schema";
import { extractAcceptanceCriteria } from "../utils";

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

	const counted: Array<{ criterion: string; matched: number; total: number }> =
		[];

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

		const matched = keywords.filter((kw) => allTasksText.includes(kw)).length;
		counted.push({ criterion, matched, total: keywords.length });
	}

	// Whether each criterion is covered is a `spec.coverage` decision.
	const covered = decideEach(defaultDecidePorts, {
		type: "spec.coverage",
		check: "criterion",
		trusted: counted.map(({ matched, total }) => ({ matched, total })),
		untrusted: counted.map(({ criterion }) => ({ text: criterion })),
	});
	const details = counted
		.filter((_, i) => covered[i] === false)
		.map(({ criterion }) => `Criterion not covered in tasks: "${criterion}"`);

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

// ─── Ticking ─────────────────────────────────────────────────────────────────

/**
 * Who ticks a checklist item (FR-SPEC-6). Only a `decide` decision or a
 * human may; the writing agent never ticks its own checklist.
 */
export type TickSource =
	| Readonly<{ kind: "decide"; decisionId: string }>
	| Readonly<{ kind: "human"; actor: string }>
	| Readonly<{ kind: "agent"; agentId: string }>;

export type TickError = Readonly<{
	kind:
		| "source_not_allowed"
		| "invalid_source"
		| "unknown_decision"
		| "item_not_found"
		| "already_ticked";
	message: string;
}>;

export type TickOptions = Readonly<{
	/** When given, a decide id must be one the decision log holds. */
	isKnownDecision?: (id: string) => boolean;
}>;

/** An item ticked with no recorded decide or human source. */
export type UnattestedTick = Readonly<{ item: string; line: number }>;

const CHECKLIST_ITEM = /^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/;
const TICKED_BY = /<!--\s*ticked-by:\s*(decide|human):\S+\s*-->/;
/** Human actors: a name without whitespace or comment terminators. */
const ACTOR = /^[^\s<>]{1,128}$/;

/** Bold label (`**T-001**`, `**Stack alignment**`) or leading task id. */
function itemLabel(text: string): string | undefined {
	return (
		text.match(/^\*\*(.+?)\*\*/)?.[1]?.trim() ?? text.match(/^(T-?\d+)\b/i)?.[1]
	);
}

function tickFailure(
	kind: TickError["kind"],
	message: string,
): Result<never, TickError> {
	return { ok: false, error: { kind, message } };
}

/** The provenance tag for `source`, or why the source may not tick. */
function provenance(
	source: TickSource,
	options: TickOptions,
): Result<string, TickError> {
	switch (source.kind) {
		case "agent":
			return tickFailure(
				"source_not_allowed",
				`agent ${source.agentId} cannot tick its own checklist; a decide id or a human must`,
			);
		case "decide":
			// Decide ids follow the decision log's id format.
			if (!ID_PATTERN.test(source.decisionId)) {
				return tickFailure("invalid_source", "decide id is malformed");
			}
			if (options.isKnownDecision?.(source.decisionId) === false) {
				return tickFailure(
					"unknown_decision",
					`decision ${source.decisionId} is not in the decision log`,
				);
			}
			return { ok: true, value: `decide:${source.decisionId}` };
		case "human": {
			const actor = source.actor.trim();
			if (!ACTOR.test(actor)) {
				return tickFailure("invalid_source", "human tick needs an actor name");
			}
			return { ok: true, value: `human:${actor}` };
		}
		default: {
			const unreachable: never = source;
			return unreachable;
		}
	}
}

/**
 * Ticks the checklist item labelled `item` in `content` and records who
 * ticked it. Refuses the writing agent, malformed sources, unknown decide ids
 * (when `isKnownDecision` is given), unknown items and items already ticked.
 */
export function tickChecklistItem(
	content: string,
	item: string,
	source: TickSource,
	options: TickOptions = {},
): Result<string, TickError> {
	const tag = provenance(source, options);
	if (!tag.ok) return tag;
	const lines = content.split("\n");
	const index = lines.findIndex((line) => {
		const text = line.match(CHECKLIST_ITEM)?.[4];
		return text !== undefined && itemLabel(text) === item;
	});
	const match = lines[index]?.match(CHECKLIST_ITEM);
	if (!match) return tickFailure("item_not_found", `no checklist item ${item}`);
	if (match[2] !== " ") {
		return tickFailure("already_ticked", `${item} is already ticked`);
	}
	lines[index] =
		`${match[1]}x${match[3]}${match[4]} <!-- ticked-by: ${tag.value} -->`;
	return { ok: true, value: lines.join("\n") };
}

/** Ticked items that carry no `ticked-by` decide or human source. */
export function unattestedTicks(content: string): readonly UnattestedTick[] {
	const found: UnattestedTick[] = [];
	for (const [i, line] of content.split("\n").entries()) {
		const match = line.match(CHECKLIST_ITEM);
		const text = match?.[4];
		if (text === undefined || match?.[2] === " ") continue;
		if (TICKED_BY.test(text)) continue;
		found.push({ item: itemLabel(text) ?? text.trim(), line: i + 1 });
	}
	return found;
}
