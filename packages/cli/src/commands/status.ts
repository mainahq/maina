import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { assembleContext, loadWorkingContext } from "@mainahq/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StatusActionOptions {
	cwd?: string;
}

export interface StatusActionResult {
	displayed: boolean;
	branch?: string;
	verificationPassed?: boolean;
	noVerificationData?: boolean;
	checks?: Array<{ name: string; passed: boolean }>;
	timestamp?: string;
	touchedFilesCount?: number;
	contextTokens?: number;
	contextLayers?: Array<{ name: string; tokens: number; included: boolean }>;
}

export interface StatusDeps {
	loadWorkingContext: (
		mainaDir: string,
		repoRoot: string,
	) => Promise<{
		branch: string;
		touchedFiles: string[];
		lastVerification: {
			passed: boolean;
			checks: Array<{ name: string; passed: boolean }>;
			timestamp: string;
		} | null;
		updatedAt: string;
	}>;
	assembleContext: (
		command: string,
		options: { repoRoot: string; mainaDir: string },
	) => Promise<{
		tokens: number;
		layers: Array<{ name: string; tokens: number; included: boolean }>;
	}>;
}

// ── Default Dependencies ─────────────────────────────────────────────────────

const defaultDeps: StatusDeps = {
	loadWorkingContext: loadWorkingContext as StatusDeps["loadWorkingContext"],
	assembleContext: assembleContext as unknown as StatusDeps["assembleContext"],
};

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core status logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function statusAction(
	options: StatusActionOptions,
	deps: StatusDeps = defaultDeps,
): Promise<StatusActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	// ── Step 1: Load working context ──────────────────────────────────
	const workingCtx = await deps.loadWorkingContext(mainaDir, cwd);

	const result: StatusActionResult = {
		displayed: true,
		branch: workingCtx.branch,
		touchedFilesCount: workingCtx.touchedFiles.length,
	};

	// ── Step 2: Verification info ─────────────────────────────────────
	if (workingCtx.lastVerification === null) {
		result.noVerificationData = true;
	} else {
		result.verificationPassed = workingCtx.lastVerification.passed;
		result.checks = workingCtx.lastVerification.checks;
		result.timestamp = workingCtx.lastVerification.timestamp;
	}

	// ── Step 3: Context layer summary ─────────────────────────────────
	try {
		const ctx = await deps.assembleContext("status", {
			repoRoot: cwd,
			mainaDir,
		});
		result.contextTokens = ctx.tokens;
		result.contextLayers = ctx.layers;
	} catch {
		// Context assembly failure should not block status display
	}

	return result;
}

// ── Display Helper ───────────────────────────────────────────────────────────

function displayStatus(result: StatusActionResult): void {
	log.info(`  Branch: ${result.branch}`);

	if (result.noVerificationData) {
		log.info("  No verification data yet. Run `maina commit` first.");
		return;
	}

	// Verification summary
	if (result.verificationPassed !== undefined && result.timestamp) {
		const status = result.verificationPassed ? "passed" : "failed";
		log.info(`  Last verification: ${status} (${result.timestamp})`);
	}

	// Individual check results
	if (result.checks) {
		for (const check of result.checks) {
			const icon = check.passed ? "pass" : "fail";
			log.info(`    [${icon}] ${check.name}`);
		}
	}

	// Touched files
	if (result.touchedFilesCount !== undefined) {
		log.info(`  Touched files: ${result.touchedFilesCount}`);
	}

	// Context layers
	if (result.contextTokens !== undefined && result.contextLayers) {
		const layerParts = result.contextLayers
			.filter((l) => l.included)
			.map((l) => `${l.name}: ${l.tokens}`)
			.join(", ");
		log.info(`  Context: ${result.contextTokens} tokens (${layerParts})`);
	}
}

// ── Commander Command ────────────────────────────────────────────────────────

export function statusCommand(): Command {
	return new Command("status")
		.description("Show current branch verification status")
		.action(async () => {
			intro("maina status");

			const result = await statusAction({});

			if (!result.displayed) {
				log.warning("Could not load status.");
				outro("Done.");
				return;
			}

			displayStatus(result);
			outro("Done.");
		});
}
