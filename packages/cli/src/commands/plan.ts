import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import {
	createFeatureDir,
	getNextFeatureNumber,
	scaffoldFeature,
	verifyPlan,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlanActionOptions {
	name: string;
	cwd?: string;
	noVerify?: boolean;
}

export interface PlanActionResult {
	created: boolean;
	reason?: string;
	featureNumber?: string;
	branch?: string;
	featureDir?: string;
}

// ── Git Helpers ──────────────────────────────────────────────────────────────

export async function gitCheckout(
	branch: string,
	cwd: string,
): Promise<{ exitCode: number; stderr: string }> {
	const proc = Bun.spawn(["git", "checkout", "-b", branch], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stderr };
}

export async function gitAdd(
	files: string[],
	cwd: string,
): Promise<{ exitCode: number }> {
	const proc = Bun.spawn(["git", "add", ...files], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	return { exitCode };
}

export async function gitCommit(
	message: string,
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["git", "commit", "-m", message], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stdout, stderr };
}

// ── Dependency Injection ─────────────────────────────────────────────────────

export interface PlanDeps {
	gitCheckout: (
		branch: string,
		cwd: string,
	) => Promise<{ exitCode: number; stderr: string }>;
	gitAdd: (files: string[], cwd: string) => Promise<{ exitCode: number }>;
	gitCommit: (
		message: string,
		cwd: string,
	) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const defaultDeps: PlanDeps = { gitCheckout, gitAdd, gitCommit };

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a string to kebab-case for branch names.
 */
function toKebabCase(input: string): string {
	return input
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/gi, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core plan logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function planAction(
	options: PlanActionOptions,
	deps: PlanDeps = defaultDeps,
): Promise<PlanActionResult> {
	const cwd = options.cwd ?? process.cwd();

	// ── Step 1: Get next feature number ──────────────────────────────────
	const numberResult = await getNextFeatureNumber(cwd);

	if (!numberResult.ok) {
		log.error(`Failed to get feature number: ${numberResult.error}`);
		return {
			created: false,
			reason: `Failed to get feature number: ${numberResult.error}`,
		};
	}

	const featureNumber = numberResult.value;
	const kebabName = toKebabCase(options.name);
	const branchName = `feature/${featureNumber}-${kebabName}`;

	// ── Step 2: Create feature directory ──────────────────────────────────
	const dirResult = await createFeatureDir(cwd, featureNumber, options.name);

	if (!dirResult.ok) {
		log.error(`Failed to create feature directory: ${dirResult.error}`);
		return {
			created: false,
			reason: `Failed to create feature directory: ${dirResult.error}`,
		};
	}

	const featureDir = dirResult.value;

	// ── Step 3: Scaffold template files ──────────────────────────────────
	const scaffoldResult = await scaffoldFeature(featureDir);

	if (!scaffoldResult.ok) {
		log.error(`Failed to scaffold feature: ${scaffoldResult.error}`);
		return {
			created: false,
			reason: `Failed to scaffold feature: ${scaffoldResult.error}`,
		};
	}

	// ── Step 4: Create and checkout git branch ───────────────────────────
	const { exitCode: checkoutCode, stderr: checkoutStderr } =
		await deps.gitCheckout(branchName, cwd);

	if (checkoutCode !== 0) {
		log.error(
			`Failed to create branch "${branchName}": ${checkoutStderr.trim()}`,
		);
		return {
			created: false,
			reason: `Failed to create branch "${branchName}": ${checkoutStderr.trim()}`,
		};
	}

	// ── Step 5: Run plan verification checklist (unless --no-verify) ─────
	if (!options.noVerify) {
		const planPath = join(featureDir, "plan.md");
		const specPath = join(featureDir, "spec.md");
		const verifyResult = verifyPlan(planPath, specPath);

		if (verifyResult.ok && !verifyResult.value.passed) {
			log.warning("Plan verification warnings:");
			for (const check of verifyResult.value.checks) {
				if (!check.passed) {
					log.warning(`  ${check.name}:`);
					for (const detail of check.details) {
						log.warning(`    - ${detail}`);
					}
				}
			}
		}
	}

	// ── Step 6: Stage scaffolded files and commit ────────────────────────
	const specFile = join(featureDir, "spec.md");
	const planFile = join(featureDir, "plan.md");
	const tasksFile = join(featureDir, "tasks.md");

	await deps.gitAdd([specFile, planFile, tasksFile], cwd);

	const commitMsg = `feat(core): scaffold feature ${featureNumber}-${kebabName}`;
	const { exitCode: commitCode, stderr: commitStderr } = await deps.gitCommit(
		commitMsg,
		cwd,
	);

	if (commitCode !== 0) {
		log.warning(`Git commit failed: ${commitStderr.trim()}`);
	}

	// ── Step 7: Return result ────────────────────────────────────────────
	return {
		created: true,
		featureNumber,
		branch: branchName,
		featureDir,
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function planCommand(): Command {
	return new Command("plan")
		.description("Create feature branch with structured plan")
		.argument("<name>", "Feature name")
		.option("--no-verify", "Skip plan verification checklist")
		.action(async (name, options) => {
			intro("maina plan");

			const result = await planAction({
				name,
				noVerify: !options.verify, // Commander parses --no-verify as verify: false
			});

			if (result.created) {
				log.success(`Feature ${result.featureNumber} created`);
				log.info(`Branch: ${result.branch}`);
				log.info(`Directory: ${result.featureDir}`);
				outro("Plan ready — edit spec.md and plan.md, then run `maina spec`");
			} else {
				outro(`Aborted: ${result.reason}`);
			}
		});
}
