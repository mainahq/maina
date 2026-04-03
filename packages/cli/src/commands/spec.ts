import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { getCurrentBranch } from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpecActionOptions {
	featureDir?: string; // Explicit feature dir, or auto-detect from branch
	output?: string; // Output file path (default: feature dir / spec-tests.ts)
	cwd?: string;
}

export interface SpecActionResult {
	generated: boolean;
	reason?: string;
	outputPath?: string;
	taskCount?: number;
}

export interface SpecDeps {
	getCurrentBranch: (cwd: string) => Promise<string>;
}

// ── Default Dependencies ─────────────────────────────────────────────────────

const defaultDeps: SpecDeps = { getCurrentBranch };

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
 * Pure function: parses plan.md content and generates TDD test stubs.
 *
 * - Parses task lines (- T001: or - [ ] T001:)
 * - Creates it() blocks with failing expects (red phase)
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
			lines.push(`\tit("${task.id}: ${testName}", () => {`);
			lines.push("\t\t// TODO: implement test");
			lines.push("\t\texpect(true).toBe(false); // Red phase");
			lines.push("\t});");
		}
	}

	lines.push("});");
	lines.push("");

	return lines.join("\n");
}

// ── Feature Directory Resolution ─────────────────────────────────────────────

/**
 * Extract feature name from branch (e.g. "feature/001-user-auth" → "001-user-auth").
 * Returns null if the branch doesn't match the feature pattern.
 */
function extractFeatureFromBranch(branch: string): string | null {
	const match = branch.match(/^feature\/(.+)$/);
	return match?.[1] ?? null;
}

/**
 * Find a matching feature directory in .maina/features/ given a feature name.
 */
function findFeatureDir(cwd: string, featureName: string): string | null {
	const featuresDir = join(cwd, ".maina", "features");

	if (!existsSync(featuresDir)) {
		return null;
	}

	const entries = readdirSync(featuresDir);
	for (const entry of entries) {
		if (entry === featureName) {
			const fullPath = join(featuresDir, entry);
			return fullPath;
		}
	}

	return null;
}

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core spec logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function specAction(
	options: SpecActionOptions,
	deps: SpecDeps = defaultDeps,
): Promise<SpecActionResult> {
	const cwd = options.cwd ?? process.cwd();

	// ── Step 1: Determine feature directory ──────────────────────────────
	let featureDir: string;

	if (options.featureDir) {
		featureDir = options.featureDir;
	} else {
		const branch = await deps.getCurrentBranch(cwd);
		const featureName = extractFeatureFromBranch(branch);

		if (!featureName) {
			return {
				generated: false,
				reason: `Not on a feature branch (current: "${branch}"). Use --feature-dir to specify explicitly.`,
			};
		}

		const detected = findFeatureDir(cwd, featureName);
		if (!detected) {
			return {
				generated: false,
				reason: `Feature directory not found for "${featureName}" in .maina/features/`,
			};
		}

		featureDir = detected;
	}

	// ── Step 2: Read plan.md ─────────────────────────────────────────────
	const planPath = join(featureDir, "plan.md");

	if (!existsSync(planPath)) {
		return {
			generated: false,
			reason: `plan.md not found at ${planPath}`,
		};
	}

	const planContent = readFileSync(planPath, "utf-8");

	// ── Step 3: Extract feature name for describe block ──────────────────
	// Try to get feature name from dir name (e.g. "001-user-auth" → "user-auth")
	const dirBasename = featureDir.split("/").pop() ?? "unknown";
	const featureName = dirBasename.replace(/^\d+-/, "");

	// ── Step 4: Generate test stubs ──────────────────────────────────────
	const testContent = generateTestStubs(planContent, featureName);
	const taskCount = (testContent.match(/\bit\(/g) ?? []).length;

	// ── Step 5: Write output file ────────────────────────────────────────
	const outputPath = options.output ?? join(featureDir, "spec-tests.ts");

	// Ensure parent directory exists
	const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
	if (outputDir && !existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}

	await Bun.write(outputPath, testContent);

	return {
		generated: true,
		outputPath,
		taskCount,
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function specCommand(): Command {
	return new Command("spec")
		.description("Generate TDD test stubs from plan")
		.option("--feature-dir <dir>", "Feature directory path")
		.option("-o, --output <path>", "Output file path")
		.action(async (options) => {
			intro("maina spec");

			const result = await specAction({
				featureDir: options.featureDir,
				output: options.output,
			});

			if (result.generated) {
				log.success(`Generated ${result.taskCount} test stub(s)`);
				log.info(`Output: ${result.outputPath}`);
				outro("Test stubs ready — run tests to see red phase");
			} else {
				log.error(result.reason ?? "Unknown error");
				outro("Aborted");
			}
		});
}
