import { join } from "node:path";
import {
	confirm,
	intro,
	isCancel,
	log,
	outro,
	select,
	text,
} from "@clack/prompts";
import {
	appendWorkflowStep,
	createFeatureDir,
	type DesignChoices,
	getCurrentBranch,
	getNextFeatureNumber,
	getWorkflowId,
	recordFeedbackAsync,
	resetWorkflowContext,
	scaffoldFeature,
	scaffoldFeatureWithContext,
	toKebabCase,
	verifyPlan,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlanActionOptions {
	name: string;
	cwd?: string;
	noVerify?: boolean;
	interactive?: boolean;
	/** Pre-supplied design choices (for testing or programmatic use) */
	designChoices?: DesignChoices;
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

// ── Interactive Design Prompts ───────────────────────────────────────────────

/** Architecture patterns users can choose from during planning */
const ARCHITECTURE_PATTERNS = [
	{
		value: "repository",
		label: "Repository pattern",
		hint: "Data access abstraction layer",
	},
	{
		value: "service-layer",
		label: "Service layer",
		hint: "Business logic in service classes",
	},
	{
		value: "event-driven",
		label: "Event-driven",
		hint: "Pub/sub, message queues, reactive",
	},
	{
		value: "pipeline",
		label: "Pipeline / middleware",
		hint: "Sequential processing stages",
	},
	{
		value: "plugin",
		label: "Plugin architecture",
		hint: "Extensible via hooks/plugins",
	},
	{ value: "cqrs", label: "CQRS", hint: "Separate read/write models" },
	{
		value: "other",
		label: "Other / custom",
		hint: "Describe your own approach",
	},
] as const;

/**
 * Collect design choices interactively from the user.
 * Returns DesignChoices with all user decisions.
 */
export async function collectDesignChoices(
	featureName: string,
): Promise<DesignChoices | null> {
	// 1. Feature description
	const description = await text({
		message: `Describe "${featureName}" in 1-2 sentences:`,
		placeholder: "What does this feature do and why is it needed?",
	});
	if (isCancel(description)) return null;

	// 2. Architecture pattern
	const pattern = await select({
		message: "Architecture pattern:",
		options: [...ARCHITECTURE_PATTERNS],
	});
	if (isCancel(pattern)) return null;

	let patternName = String(pattern);
	if (pattern === "other") {
		const custom = await text({
			message: "Describe your architecture approach:",
			placeholder: "e.g., hexagonal architecture with ports and adapters",
		});
		if (isCancel(custom)) return null;
		patternName = custom;
	}

	// 3. Library choices (free text, comma-separated)
	const libInput = await text({
		message: "Key libraries or tools (comma-separated, or skip):",
		placeholder: "e.g., zod, hono, drizzle",
		defaultValue: "",
	});
	if (isCancel(libInput)) return null;
	const libraries = libInput
		? libInput
				.split(",")
				.map((l) => l.trim())
				.filter(Boolean)
		: [];

	// 4. Tradeoff decisions
	const tradeoffs: string[] = [];

	const hasTradeoffs = await confirm({
		message: "Any design tradeoffs to record?",
		initialValue: false,
	});
	if (isCancel(hasTradeoffs)) return null;

	if (hasTradeoffs) {
		const tradeoffInput = await text({
			message: "Describe key tradeoffs (one per line or comma-separated):",
			placeholder: "e.g., Chose simplicity over performance for MVP",
		});
		if (isCancel(tradeoffInput)) return null;
		if (tradeoffInput) {
			const parts = tradeoffInput.includes("\n")
				? tradeoffInput.split("\n")
				: tradeoffInput.split(",");
			tradeoffs.push(...parts.map((t) => t.trim()).filter(Boolean));
		}
	}

	// 5. Resolve ambiguities
	const clarifications: Array<{ question: string; answer: string }> = [];

	const hasQuestions = await confirm({
		message: "Any open questions you can answer now?",
		initialValue: false,
	});
	if (isCancel(hasQuestions)) return null;

	if (hasQuestions) {
		let moreQuestions = true;
		while (moreQuestions) {
			const question = await text({
				message: "Question:",
				placeholder: "e.g., Should we support OAuth?",
			});
			if (isCancel(question)) break;

			const answer = await text({
				message: "Answer:",
				placeholder: "e.g., Yes, Google and GitHub OAuth via passport.js",
			});
			if (isCancel(answer)) break;

			if (question && answer) {
				clarifications.push({ question, answer });
			}

			const more = await confirm({
				message: "Another question?",
				initialValue: false,
			});
			if (isCancel(more) || !more) {
				moreQuestions = false;
			}
		}
	}

	return {
		description: description || undefined,
		pattern: patternName,
		libraries: libraries.length > 0 ? libraries : undefined,
		tradeoffs: tradeoffs.length > 0 ? tradeoffs : undefined,
		clarifications: clarifications.length > 0 ? clarifications : undefined,
	};
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
	const choices = options.designChoices;
	const scaffoldResult = choices
		? await scaffoldFeatureWithContext(featureDir, options.name, choices)
		: await scaffoldFeature(featureDir);

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
	const mainaDir = join(cwd, ".maina");
	resetWorkflowContext(mainaDir, branchName);
	appendWorkflowStep(
		mainaDir,
		"plan",
		`Feature ${featureNumber} scaffolded. Branch: ${branchName}. Dir: ${featureDir}.`,
	);

	const branch = await getCurrentBranch(cwd);
	const workflowId = getWorkflowId(branch);
	recordFeedbackAsync(mainaDir, {
		promptHash: "deterministic",
		task: "plan",
		accepted: true,
		timestamp: new Date().toISOString(),
		workflowStep: "plan",
		workflowId,
	});

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
		.option("--no-interactive", "Skip interactive design prompts")
		.action(async (name, options) => {
			intro("maina plan");

			let designChoices: DesignChoices | undefined;

			// Interactive mode: collect design choices from user
			if (options.interactive !== false) {
				log.info("Let's define the design for this feature.");
				const choices = await collectDesignChoices(name);
				if (choices === null) {
					outro("Cancelled.");
					return;
				}
				designChoices = choices;
			}

			const result = await planAction({
				name,
				noVerify: !options.verify, // Commander parses --no-verify as verify: false
				interactive: options.interactive !== false,
				designChoices,
			});

			if (result.created) {
				log.success(`Feature ${result.featureNumber} created`);
				log.info(`Branch: ${result.branch}`);
				log.info(`Directory: ${result.featureDir}`);
				if (designChoices) {
					log.info("Design choices saved to spec.md and plan.md");
				}
				outro("Plan ready — edit spec.md and plan.md, then run `maina spec`");
			} else {
				outro(`Aborted: ${result.reason}`);
			}
		});
}
