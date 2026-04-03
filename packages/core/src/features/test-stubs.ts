/**
 * TDD test stub generation from plan.md task lists.
 *
 * Parses task lines (- T001: or - [ ] T001:) from plan content and
 * generates bun:test stubs with failing expects (red phase).
 */

// ── Ambiguity Detection ──────────────────────────────────────────────────────

const AMBIGUOUS_PATTERNS = [
	/\bmaybe\b/i,
	/\bmight\b/i,
	/\bpossibly\b/i,
	/\bpossible\b/i,
	/\btbd\b/i,
	/\bor\b/i,
];

function isAmbiguous(text: string): boolean {
	return AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(text));
}

// ── Task Parsing ─────────────────────────────────────────────────────────────

interface ParsedTask {
	id: string;
	description: string;
	ambiguous: boolean;
	rawLine: string;
}

/**
 * Parse task lines from plan.md content.
 * Matches patterns like:
 *   - T001: description
 *   - [ ] T001: description
 *   - [x] T001: description
 */
function parseTasks(planContent: string): ParsedTask[] {
	const lines = planContent.split("\n");
	const tasks: ParsedTask[] = [];

	// Match: - T001: ... or - [ ] T001: ... or - [x] T001: ...
	const taskPattern = /^-\s+(?:\[[ x]\]\s+)?T(\d+):\s*(.+)$/;

	for (const line of lines) {
		const trimmed = line.trim();
		const match = trimmed.match(taskPattern);
		if (match?.[1] && match[2]) {
			const id = `T${match[1]}`;
			const description = match[2].trim();
			tasks.push({
				id,
				description,
				ambiguous: isAmbiguous(description),
				rawLine: trimmed,
			});
		}
	}

	return tasks;
}

// ── Test Stub Generation ─────────────────────────────────────────────────────

/**
 * Convert a task description to a test-friendly name.
 * Lowercases the first letter and prepends "should".
 */
function toTestName(description: string): string {
	const lower = description.charAt(0).toLowerCase() + description.slice(1);
	return `should ${lower}`;
}

/**
 * Detect if a task handles user input (needs security tests).
 */
function handlesInput(description: string): boolean {
	const inputPatterns =
		/\b(input|param|arg|path|file|query|search|body|title|label|name|url|content)\b/i;
	return inputPatterns.test(description);
}

/**
 * Pure function: parses plan.md content and generates TDD test stubs.
 *
 * - Parses task lines (- T001: or - [ ] T001:)
 * - Creates it() blocks with failing expects (red phase)
 * - Generates five test categories per task: happy path, edge cases, error handling, security, integration
 * - Adds [NEEDS CLARIFICATION] for ambiguous tasks
 * - Returns complete TypeScript test file as a string
 */
export function generateTestStubs(
	planContent: string,
	featureName: string,
): string {
	const tasks = parseTasks(planContent);

	const lines: string[] = [];

	lines.push('import { describe, expect, it } from "bun:test";');
	lines.push("");
	lines.push(`describe("Feature: ${featureName}", () => {`);

	for (const task of tasks) {
		const testName = toTestName(task.description);

		if (task.ambiguous) {
			lines.push("");
			lines.push(
				`\t// [NEEDS CLARIFICATION] ${task.id}: task description mentions ambiguous language — clarify requirement`,
			);
			lines.push(`\tit("${task.id}: ${testName}", () => {`);
			lines.push(
				"\t\t// [NEEDS CLARIFICATION] Ambiguous requirement — clarify before implementing",
			);
			lines.push("\t\texpect(true).toBe(false); // Red phase");
			lines.push("\t});");
		} else {
			lines.push("");
			lines.push(`\tdescribe("${task.id}: ${task.description}", () => {`);

			// Happy path
			lines.push(`\t\tit("happy path: ${testName}", () => {`);
			lines.push("\t\t\texpect(true).toBe(false); // Red phase");
			lines.push("\t\t});");

			// Edge cases
			lines.push("");
			lines.push(`\t\tit("edge case: handles empty input", () => {`);
			lines.push("\t\t\texpect(true).toBe(false); // Red phase");
			lines.push("\t\t});");

			// Error handling
			lines.push("");
			lines.push(`\t\tit("error: returns Result error on failure", () => {`);
			lines.push("\t\t\texpect(true).toBe(false); // Red phase");
			lines.push("\t\t});");

			// Security (only if task handles input)
			if (handlesInput(task.description)) {
				lines.push("");
				lines.push(`\t\tit("security: rejects malicious input", () => {`);
				lines.push("\t\t\t// Test path traversal, injection, oversized input");
				lines.push("\t\t\texpect(true).toBe(false); // Red phase");
				lines.push("\t\t});");
			}

			lines.push("\t});");
		}
	}

	lines.push("});");
	lines.push("");

	return lines.join("\n");
}
