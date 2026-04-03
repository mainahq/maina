import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { intro, isCancel, log, outro, select, text } from "@clack/prompts";
import {
	generateSpecQuestions,
	generateTestStubs,
	getCurrentBranch,
	type SpecQuestion,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpecActionOptions {
	featureDir?: string; // Explicit feature dir, or auto-detect from branch
	output?: string; // Output file path (default: feature dir / spec-tests.ts)
	cwd?: string;
	noRedGreen?: boolean; // Skip red-green enforcement check
	noInteractive?: boolean; // Skip clarifying questions phase
}

export interface SpecActionResult {
	generated: boolean;
	reason?: string;
	outputPath?: string;
	taskCount?: number;
	redPhaseVerified?: boolean;
	redGreenWarning?: string;
	questionsAsked?: number;
}

export interface SpecDeps {
	getCurrentBranch: (cwd: string) => Promise<string>;
	runTests?: (
		testPath: string,
		cwd: string,
	) => Promise<{ passCount: number; failCount: number }>;
}

// ── Default Dependencies ─────────────────────────────────────────────────────

/**
 * Default test runner: spawns `bun test` on the given file and parses pass/fail counts.
 */
async function defaultRunTests(
	testPath: string,
	cwd: string,
): Promise<{ passCount: number; failCount: number }> {
	const proc = Bun.spawn(["bun", "test", testPath], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;

	const passMatch = stdout.match(/(\d+)\s+pass/);
	const failMatch = stdout.match(/(\d+)\s+fail/);
	const passCount = passMatch ? Number.parseInt(passMatch[1] as string, 10) : 0;
	const failCount = failMatch ? Number.parseInt(failMatch[1] as string, 10) : 0;

	return { passCount, failCount };
}

const defaultDeps: SpecDeps = { getCurrentBranch, runTests: defaultRunTests };

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

	// ── Step 3: Interactive clarifying questions ─────────────────────────
	let questionsAsked: number | undefined;

	if (!options.noInteractive) {
		const mainaDir = join(cwd, ".maina");
		const questionsResult = await generateSpecQuestions(planContent, mainaDir);

		if (questionsResult.ok && questionsResult.value.length > 0) {
			const answers = await askClarifyingQuestions(questionsResult.value);
			if (answers.length > 0) {
				const specPath = join(featureDir, "spec.md");
				appendClarifications(specPath, answers);
				questionsAsked = answers.length;
			}
		}
	}

	// ── Step 4: Extract feature name for describe block ──────────────────
	// Try to get feature name from dir name (e.g. "001-user-auth" → "user-auth")
	const dirBasename = featureDir.split("/").pop() ?? "unknown";
	const featureName = dirBasename.replace(/^\d+-/, "");

	// ── Step 5: Generate test stubs ──────────────────────────────────────
	const testContent = generateTestStubs(planContent, featureName);
	const taskCount = (testContent.match(/\bit\(/g) ?? []).length;

	// ── Step 6: Write output file ────────────────────────────────────────
	const outputPath = options.output ?? join(featureDir, "spec-tests.ts");

	// Ensure parent directory exists
	const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
	if (outputDir && !existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}

	await Bun.write(outputPath, testContent);

	const result: SpecActionResult = {
		generated: true,
		outputPath,
		taskCount,
		questionsAsked,
	};

	// ── Step 7: Red-green enforcement ────────────────────────────────────
	if (!options.noRedGreen && deps.runTests) {
		try {
			const { passCount, failCount } = await deps.runTests(outputPath, cwd);

			if (passCount > 0) {
				result.redGreenWarning = `${passCount} stub(s) passed immediately — these may not be testing anything useful`;
			}
			result.redPhaseVerified = failCount > 0 && passCount === 0;
		} catch {
			// Red-green check failure should not block spec generation
		}
	}

	return result;
}

// ── Interactive Question Helpers ─────────────────────────────────────────────

interface ClarificationAnswer {
	question: string;
	answer: string;
}

async function askClarifyingQuestions(
	questions: SpecQuestion[],
): Promise<ClarificationAnswer[]> {
	const answers: ClarificationAnswer[] = [];

	for (const q of questions) {
		let answer: string | symbol;

		if (q.type === "select" && q.options && q.options.length > 0) {
			answer = await select({
				message: q.question,
				options: q.options.map((o) => ({ value: o, label: o })),
			});
		} else {
			answer = await text({
				message: q.question,
				placeholder: "Your answer",
			});
		}

		if (isCancel(answer)) {
			break;
		}

		answers.push({ question: q.question, answer: answer as string });
	}

	return answers;
}

function appendClarifications(
	specPath: string,
	answers: ClarificationAnswer[],
): void {
	if (answers.length === 0) return;

	let section = "\n\n## Clarifications\n\n";
	for (const { question, answer } of answers) {
		section += `**Q:** ${question}\n**A:** ${answer}\n\n`;
	}

	if (existsSync(specPath)) {
		appendFileSync(specPath, section);
	}
}

// ── Commander Command ────────────────────────────────────────────────────────

export function specCommand(): Command {
	return new Command("spec")
		.description("Generate TDD test stubs from plan")
		.option("--feature-dir <dir>", "Feature directory path")
		.option("-o, --output <path>", "Output file path")
		.option("--no-red-green", "Skip red-green enforcement check")
		.option("--no-interactive", "Skip clarifying questions phase")
		.action(async (options) => {
			intro("maina spec");

			const result = await specAction({
				featureDir: options.featureDir,
				output: options.output,
				noRedGreen: options.redGreen === false,
				noInteractive: options.interactive === false,
			});

			if (result.generated) {
				if (result.questionsAsked) {
					log.info(
						`Recorded ${result.questionsAsked} clarification(s) in spec.md`,
					);
				}
				log.success(`Generated ${result.taskCount} test stub(s)`);
				log.info(`Output: ${result.outputPath}`);

				if (result.redPhaseVerified) {
					log.success("Red phase verified — all stubs fail as expected");
				} else if (result.redGreenWarning) {
					log.warning(result.redGreenWarning);
				}

				outro("Test stubs ready — run tests to see red phase");
			} else {
				log.error(result.reason ?? "Unknown error");
				outro("Aborted");
			}
		});
}
