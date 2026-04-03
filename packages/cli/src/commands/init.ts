import { existsSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { bootstrap, type InitReport, type Result } from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface InitActionOptions {
	cwd?: string;
	force?: boolean;
}

/** Dependency injection for testing — avoids mock.module */
export interface InitActionDeps {
	intro: (title?: string) => void;
	outro: (message?: string) => void;
	log: {
		info: (message: string) => void;
		error: (message: string) => void;
		warning: (message: string) => void;
		success: (message: string) => void;
		message: (message: string) => void;
		step: (message: string) => void;
	};
}

const defaultDeps: InitActionDeps = { intro, outro, log };

// ── Core Action (testable) ──────────────────────────────────────────────────

/**
 * The core init logic, extracted so tests can call it directly
 * with injected dependencies.
 */
export async function initAction(
	options: InitActionOptions,
	deps: InitActionDeps = defaultDeps,
): Promise<Result<InitReport>> {
	const cwd = options.cwd ?? process.cwd();

	// Check if this is a git repo
	if (!existsSync(join(cwd, ".git"))) {
		deps.log.error("Not a git repository. Run `git init` first.");
		return { ok: false, error: "Not a git repository" };
	}

	const result = await bootstrap(cwd, { force: options.force });

	if (!result.ok) {
		deps.log.error(`Init failed: ${result.error}`);
		return result;
	}

	const report = result.value;

	// Display created files
	if (report.created.length > 0) {
		deps.log.success(`Created ${report.created.length} file(s):`);
		for (const file of report.created) {
			deps.log.message(`  + ${file}`);
		}
	}

	// Display skipped files
	if (report.skipped.length > 0) {
		deps.log.warning(`Skipped ${report.skipped.length} existing file(s):`);
		for (const file of report.skipped) {
			deps.log.message(`  ~ ${file} (already exists)`);
		}
	}

	// Suggest next steps
	deps.log.step("Next steps:");
	deps.log.message("  1. Edit .maina/constitution.md with your project DNA");
	deps.log.message("  2. Customize .maina/prompts/ for your team");
	deps.log.message("  3. Run `maina doctor` to check your setup");

	return result;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function initCommand(): Command {
	return new Command("init")
		.description("Bootstrap Maina in this repository")
		.option("--force", "Overwrite existing files")
		.action(async (options) => {
			intro("maina init");

			const result = await initAction({
				force: options.force,
			});

			if (result.ok) {
				outro("Maina initialized!");
			} else {
				outro(`Init failed: ${result.error}`);
			}
		});
}
