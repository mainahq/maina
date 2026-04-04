import { existsSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { bootstrap, type InitReport, type Result } from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface InitActionOptions {
	cwd?: string;
	force?: boolean;
	install?: boolean;
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

/** Install hints for missing verification tools. */
const INSTALL_HINTS: Record<string, string> = {
	biome: "bun add -d @biomejs/biome",
	semgrep: "brew install semgrep",
	trivy: "brew install trivy",
	secretlint:
		"bun add -d @secretlint/secretlint-rule-preset-recommend secretlint",
	sonarqube: "brew install sonar-scanner",
	stryker: "bun add -d @stryker-mutator/core",
	"diff-cover": "pipx install diff-cover",
	ruff: "brew install ruff",
	"golangci-lint": "brew install golangci-lint",
	"cargo-clippy": "rustup component add clippy",
	"cargo-audit": "cargo install cargo-audit",
	playwright: "npx playwright install chromium",
};

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
	const s = report.detectedStack;

	// Show detected stack
	deps.log.info("Detected stack:");
	deps.log.message(`  Runtime:    ${s.runtime}`);
	deps.log.message(`  Language:   ${s.language}`);
	deps.log.message(`  Test:       ${s.testRunner}`);
	deps.log.message(`  Linter:     ${s.linter}`);
	if (s.framework !== "none") {
		deps.log.message(`  Framework:  ${s.framework}`);
	}

	// Show verification tool status
	const available = report.detectedTools.filter((t) => t.available);
	const missing = report.detectedTools.filter((t) => !t.available);

	if (available.length > 0) {
		deps.log.success(
			`Verification tools: ${available.map((t) => `${t.name} (${t.version})`).join(", ")}`,
		);
	}

	if (missing.length > 0) {
		deps.log.warning(`Missing tools: ${missing.map((t) => t.name).join(", ")}`);
		deps.log.message("  Install for deeper verification:");
		for (const t of missing) {
			const cmd = INSTALL_HINTS[t.name];
			if (cmd) {
				deps.log.message(`    ${t.name}: ${cmd}`);
			}
		}

		// Auto-install if --install flag is set
		if (options.install) {
			deps.log.step("Installing missing tools...");
			for (const t of missing) {
				const cmd = INSTALL_HINTS[t.name];
				if (!cmd || cmd.startsWith("http")) continue;
				deps.log.message(`  Installing ${t.name}...`);
				try {
					const args = cmd.split(" ");
					const proc = Bun.spawn(args, {
						cwd,
						stdout: "pipe",
						stderr: "pipe",
					});
					await proc.exited;
					if (proc.exitCode === 0) {
						deps.log.success(`    ${t.name} installed`);
					} else {
						deps.log.warning(`    ${t.name} install failed (non-zero exit)`);
					}
				} catch {
					deps.log.warning(`    ${t.name} install failed`);
				}
			}
		}
	}

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
	deps.log.message("  1. Review .maina/constitution.md — your project DNA");
	deps.log.message("  2. Run `maina doctor` to check tool health");
	deps.log.message("  3. Run `maina verify` on your first commit");
	deps.log.message("");
	deps.log.message("  Config guide:");
	deps.log.message(
		"    .maina/constitution.md  — Stack rules, shared by all agents",
	);
	deps.log.message("    AGENTS.md               — Instructions for AI agents");
	deps.log.message(
		"    CLAUDE.md               — Claude Code specific (optional)",
	);

	return result;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function initCommand(): Command {
	return new Command("init")
		.description("Bootstrap Maina in this repository")
		.option("--force", "Overwrite existing files")
		.option("--install", "Auto-install missing verification tools")
		.action(async (options) => {
			intro("maina init");

			const result = await initAction({
				force: options.force,
				install: options.install,
			});

			if (result.ok) {
				outro("Maina initialized!");
			} else {
				outro(`Init failed: ${result.error}`);
			}
		});
}
