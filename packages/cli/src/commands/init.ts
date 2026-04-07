import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { intro, isCancel, log, outro, select } from "@clack/prompts";
import {
	bootstrap,
	getApiKey,
	getToolsForLanguages,
	type InitReport,
	isHostMode,
	type Result,
} from "@mainahq/core";
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
	/** Override for testing — checks for API key availability */
	checkApiKey?: () => string | null;
	/** Override for testing — checks for host mode */
	checkHostMode?: () => boolean;
	/** Override for testing — interactive prompt for API key */
	promptApiKey?: () => Promise<{ action: string; key?: string } | null>;
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
 * Detect if an API key is available or host mode is active.
 * Returns { hasKey, inHostMode } for the init flow to decide
 * whether to enable AI generation.
 */
export function detectAIAvailability(deps: InitActionDeps): {
	hasKey: boolean;
	inHostMode: boolean;
} {
	const checkKey = deps.checkApiKey ?? getApiKey;
	const checkHost = deps.checkHostMode ?? isHostMode;
	const key = checkKey();
	const host = checkHost();
	return { hasKey: key !== null, inHostMode: host };
}

/**
 * Ensure `.maina/.env` is in `.gitignore`.
 * Adds the pattern if not already present.
 */
export function ensureGitignoreHasMainaEnv(cwd: string): void {
	const gitignorePath = join(cwd, ".gitignore");
	const pattern = ".maina/.env";

	if (existsSync(gitignorePath)) {
		const content = readFileSync(gitignorePath, "utf-8");
		if (content.includes(pattern)) return;
		// Append with newline safety
		const suffix = content.endsWith("\n") ? "" : "\n";
		appendFileSync(gitignorePath, `${suffix}${pattern}\n`, "utf-8");
	} else {
		writeFileSync(gitignorePath, `${pattern}\n`, "utf-8");
	}
}

/**
 * Save an API key to `.maina/.env`.
 */
export function saveApiKeyToEnv(cwd: string, key: string): void {
	const envPath = join(cwd, ".maina", ".env");
	writeFileSync(envPath, `OPENROUTER_API_KEY=${key}\n`, "utf-8");
}

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

	// ── API Key Detection ───────────────────────────────────────────────
	const { hasKey, inHostMode } = detectAIAvailability(deps);
	let aiAvailable = hasKey || inHostMode;

	if (hasKey) {
		deps.log.success("API key found");
	} else if (inHostMode) {
		deps.log.success("Running inside AI agent — using host delegation");
	} else {
		// Interactive prompt for API key
		const promptFn = deps.promptApiKey ?? defaultPromptApiKey;
		const apiKeyResult = await promptFn();

		if (apiKeyResult && apiKeyResult.action === "enter" && apiKeyResult.key) {
			// Save key to .maina/.env
			const { mkdirSync } = await import("node:fs");
			mkdirSync(join(cwd, ".maina"), { recursive: true });
			saveApiKeyToEnv(cwd, apiKeyResult.key);
			ensureGitignoreHasMainaEnv(cwd);
			deps.log.success("API key saved to .maina/.env");
			aiAvailable = true;
		} else if (apiKeyResult && apiKeyResult.action === "host") {
			deps.log.info(
				"Run `maina init` inside your AI coding agent for the best experience",
			);
		} else {
			deps.log.warning("Skipped API key — AI features will be limited");
		}
	}

	const result = await bootstrap(cwd, {
		force: options.force,
		aiGenerate: aiAvailable,
	});

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
	deps.log.message(`  Languages:  ${s.languages.join(", ")}`);
	deps.log.message(`  Test:       ${s.testRunner}`);
	deps.log.message(`  Linter:     ${s.linter}`);
	if (s.framework !== "none") {
		deps.log.message(`  Framework:  ${s.framework}`);
	}

	// Show AI generation status
	if (report.aiGenerated) {
		deps.log.success(
			"Constitution generated with AI (tailored to your project)",
		);
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
		// Filter install hints to only show tools relevant to detected languages
		const relevantToolNames = new Set<string>(
			getToolsForLanguages(s.languages).map((t) => t.name),
		);
		const relevantMissing = missing.filter((t) =>
			relevantToolNames.has(t.name),
		);

		if (relevantMissing.length > 0) {
			deps.log.warning(
				`Missing tools: ${relevantMissing.map((t) => t.name).join(", ")}`,
			);
			deps.log.message("  Install for deeper verification:");
			for (const t of relevantMissing) {
				const cmd = INSTALL_HINTS[t.name];
				if (cmd) {
					deps.log.message(`    ${t.name}: ${cmd}`);
				}
			}

			// Auto-install if --install flag is set
			if (options.install) {
				deps.log.step("Installing missing tools...");
				for (const t of relevantMissing) {
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
	}

	// Display created files
	if (report.created.length > 0) {
		deps.log.success(`Created ${report.created.length} file(s):`);
		for (const file of report.created) {
			deps.log.message(`  + ${file}`);
		}
	}

	// Display updated files (maina section merged)
	if (report.updated.length > 0) {
		deps.log.success(
			`Updated ${report.updated.length} file(s) with Maina section:`,
		);
		for (const file of report.updated) {
			deps.log.message(`  ↑ ${file} (maina section added)`);
		}
	}

	// Display skipped files
	if (report.skipped.length > 0) {
		deps.log.warning(`Skipped ${report.skipped.length} existing file(s):`);
		for (const file of report.skipped) {
			deps.log.message(`  ~ ${file} (already exists)`);
		}
	}

	// Show configured agent files
	const agentFiles = report.created.filter((f) =>
		[
			".mcp.json",
			"CLAUDE.md",
			"GEMINI.md",
			".cursorrules",
			"AGENTS.md",
			".github/copilot-instructions.md",
		].includes(f),
	);
	if (agentFiles.length > 0) {
		deps.log.success(`Agent files: ${agentFiles.join(", ")}`);
	}
	if (report.created.includes(".mcp.json")) {
		deps.log.success("MCP configured at .mcp.json");
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
	deps.log.message(
		"    GEMINI.md               — Gemini CLI specific (optional)",
	);
	deps.log.message("    .cursorrules            — Cursor specific (optional)");
	deps.log.message("    .mcp.json               — MCP server configuration");

	return result;
}

/**
 * Default interactive prompt for API key (uses @clack/prompts).
 * Separated for testability.
 */
async function defaultPromptApiKey(): Promise<{
	action: string;
	key?: string;
} | null> {
	const result = await select({
		message: "AI features need an API key. Choose an option:",
		options: [
			{
				value: "enter",
				label: "Enter OpenRouter API key",
				hint: "get one at openrouter.ai",
			},
			{
				value: "host",
				label: "Run maina init inside your AI coding agent",
				hint: "Claude Code, Cursor, Gemini CLI",
			},
			{
				value: "skip",
				label: "Skip",
				hint: "AI features will be limited",
			},
		],
	});

	if (isCancel(result)) {
		return { action: "skip" };
	}

	if (result === "enter") {
		const { text } = await import("@clack/prompts");
		const key = await text({
			message: "Enter your OpenRouter API key:",
			placeholder: "sk-or-v1-...",
			validate: (val) => {
				if (!val || val.trim().length === 0) return "API key cannot be empty";
				return undefined;
			},
		});
		if (isCancel(key)) {
			return { action: "skip" };
		}
		return { action: "enter", key: key as string };
	}

	return { action: result as string };
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
