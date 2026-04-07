/**
 * `maina setup` — Guided first-time setup for Maina.
 *
 * Detects the IDE/agent environment, runs init, configures MCP,
 * checks tool health, and optionally initialises the wiki.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { confirm, intro, isCancel, log, outro, spinner } from "@clack/prompts";
import { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../json";
import type { DoctorActionResult } from "./doctor";
import { doctorAction } from "./doctor";
import type { InitActionDeps } from "./init";
import { initAction } from "./init";

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentEnvironment = "claude-code" | "cursor" | "copilot" | "generic";

export interface SetupResult {
	environment: AgentEnvironment;
	initSuccess: boolean;
	mcpConfigured: boolean;
	claudeSettingsCreated: boolean;
	doctorResult: DoctorActionResult | null;
	wikiInitialized: boolean;
}

export interface SetupActionOptions {
	cwd?: string;
	json?: boolean;
	/** Skip interactive prompts — use detected defaults */
	yes?: boolean;
}

/** Dependency injection for testing — avoids mock.module */
export interface SetupActionDeps {
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
	spinner: () => {
		start: (msg?: string) => void;
		stop: (msg?: string) => void;
	};
	/** Override environment detection for testing */
	detectEnv?: () => AgentEnvironment;
	/** Override wiki init confirmation for testing */
	confirmWiki?: () => Promise<boolean>;
	/** Override init action for testing */
	runInit?: (cwd: string) => Promise<boolean>;
	/** Override doctor action for testing */
	runDoctor?: (cwd: string) => Promise<DoctorActionResult | null>;
}

const defaultDeps: SetupActionDeps = {
	intro,
	outro,
	log,
	spinner,
};

// ── Environment Detection ──────────────────────────────────────────────────

/**
 * Detect which AI agent / IDE environment is active
 * by checking well-known environment variables.
 */
export function detectEnvironment(): AgentEnvironment {
	const env = process.env;

	if (env.CLAUDE_CODE || env.CLAUDE_PROJECT_DIR) {
		return "claude-code";
	}

	// Check for any CURSOR_* env var
	const hasCursor = Object.keys(env).some((k) => k.startsWith("CURSOR_"));
	if (hasCursor) {
		return "cursor";
	}

	// Check for any GITHUB_COPILOT_* env var
	const hasCopilot = Object.keys(env).some((k) =>
		k.startsWith("GITHUB_COPILOT_"),
	);
	if (hasCopilot) {
		return "copilot";
	}

	return "generic";
}

// ── Claude Code Settings ───────────────────────────────────────────────────

/**
 * Build `.claude/settings.json` content with maina MCP server entry.
 */
export function buildClaudeSettingsJson(): string {
	return JSON.stringify(
		{
			mcpServers: {
				maina: {
					command: "npx",
					args: ["@mainahq/cli", "--mcp"],
				},
			},
		},
		null,
		2,
	);
}

/**
 * Create `.claude/settings.json` with the maina MCP server config.
 * If the file already exists and contains a maina entry, skip.
 * If it exists but has no maina entry, merge it in.
 */
export function ensureClaudeSettings(cwd: string): boolean {
	const claudeDir = join(cwd, ".claude");
	const settingsPath = join(claudeDir, "settings.json");

	if (existsSync(settingsPath)) {
		try {
			const existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
			if (existing?.mcpServers?.maina) {
				return false; // Already configured
			}
			// Merge maina into existing mcpServers
			existing.mcpServers = existing.mcpServers ?? {};
			existing.mcpServers.maina = {
				command: "npx",
				args: ["@mainahq/cli", "--mcp"],
			};
			writeFileSync(settingsPath, JSON.stringify(existing, null, 2), "utf-8");
			return true;
		} catch {
			// File exists but is invalid JSON — overwrite
			writeFileSync(settingsPath, buildClaudeSettingsJson(), "utf-8");
			return true;
		}
	}

	// Create from scratch
	mkdirSync(claudeDir, { recursive: true });
	writeFileSync(settingsPath, buildClaudeSettingsJson(), "utf-8");
	return true;
}

// ── Environment Label ──────────────────────────────────────────────────────

function envLabel(env: AgentEnvironment): string {
	switch (env) {
		case "claude-code":
			return "Claude Code";
		case "cursor":
			return "Cursor";
		case "copilot":
			return "GitHub Copilot";
		case "generic":
			return "Generic";
	}
}

// ── Core Action (testable) ─────────────────────────────────────────────────

/**
 * The core setup logic, extracted so tests can call it directly
 * with injected dependencies.
 */
export async function setupAction(
	options: SetupActionOptions,
	deps: SetupActionDeps = defaultDeps,
): Promise<SetupResult> {
	const cwd = options.cwd ?? process.cwd();
	const jsonMode = options.json ?? false;
	const autoYes = options.yes ?? false;

	const result: SetupResult = {
		environment: "generic",
		initSuccess: false,
		mcpConfigured: false,
		claudeSettingsCreated: false,
		doctorResult: null,
		wikiInitialized: false,
	};

	// ── Step 1: Detect environment ──────────────────────────────────────
	const detect = deps.detectEnv ?? detectEnvironment;
	result.environment = detect();

	if (!jsonMode) {
		deps.log.info(`Detected environment: ${envLabel(result.environment)}`);
	}

	// ── Step 2: Run init ────────────────────────────────────────────────
	const s = deps.spinner();
	if (!jsonMode) {
		s.start("Running maina init...");
	}

	if (deps.runInit) {
		result.initSuccess = await deps.runInit(cwd);
	} else {
		const initDeps: InitActionDeps = {
			intro: () => {},
			outro: () => {},
			log: deps.log,
			// In host mode or auto-yes, skip API key prompt
			checkHostMode: () => result.environment !== "generic",
		};
		const initResult = await initAction({ cwd }, initDeps);
		result.initSuccess = initResult.ok;
	}

	if (!jsonMode) {
		if (result.initSuccess) {
			s.stop("Init complete.");
		} else {
			s.stop("Init failed.");
			deps.log.warning(
				"Init did not complete — continuing with remaining steps.",
			);
		}
	}

	// ── Step 3: Configure MCP for environment ───────────────────────────
	const mcpJsonPath = join(cwd, ".mcp.json");
	result.mcpConfigured = existsSync(mcpJsonPath);

	if (result.environment === "claude-code") {
		result.claudeSettingsCreated = ensureClaudeSettings(cwd);
		if (!jsonMode) {
			if (result.claudeSettingsCreated) {
				deps.log.success("Created .claude/settings.json with MCP config");
			} else {
				deps.log.info(".claude/settings.json already configured");
			}
		}
	} else if (!jsonMode) {
		if (result.mcpConfigured) {
			deps.log.success(".mcp.json found — MCP configured");
		} else {
			deps.log.warning(".mcp.json not found — run `maina init` to create it");
		}
	}

	// ── Step 4: Run doctor ──────────────────────────────────────────────
	if (!jsonMode) {
		s.start("Checking system health...");
	}

	if (deps.runDoctor) {
		result.doctorResult = await deps.runDoctor(cwd);
	} else {
		try {
			result.doctorResult = await doctorAction({ cwd, json: true });
		} catch {
			result.doctorResult = null;
		}
	}

	if (!jsonMode) {
		if (result.doctorResult) {
			const tools = result.doctorResult.tools;
			const available = tools.filter((t) => t.available).length;
			s.stop(
				`Health check complete: ${available}/${tools.length} tools available.`,
			);
		} else {
			s.stop("Health check failed.");
		}
	}

	// ── Step 5: Wiki init (optional) ────────────────────────────────────
	let shouldInitWiki = false;

	if (deps.confirmWiki) {
		shouldInitWiki = await deps.confirmWiki();
	} else if (autoYes) {
		shouldInitWiki = true;
	} else if (!jsonMode) {
		const wikiConfirm = await confirm({
			message: "Initialize codebase wiki? (compiles knowledge from your code)",
		});
		if (!isCancel(wikiConfirm)) {
			shouldInitWiki = wikiConfirm;
		}
	}

	if (shouldInitWiki) {
		const wikiDir = join(cwd, ".maina", "wiki");
		if (existsSync(wikiDir)) {
			result.wikiInitialized = true;
			if (!jsonMode) {
				deps.log.info("Wiki already initialized.");
			}
		} else {
			if (!jsonMode) {
				deps.log.info("Run `maina wiki init` to compile codebase knowledge.");
			}
			result.wikiInitialized = false;
		}
	}

	// ── Step 6: Summary ─────────────────────────────────────────────────
	if (!jsonMode) {
		deps.log.step("Setup Summary:");
		deps.log.message(`  Environment:     ${envLabel(result.environment)}`);
		deps.log.message(
			`  Init:            ${result.initSuccess ? "\u2713 complete" : "\u2717 failed"}`,
		);
		deps.log.message(
			`  MCP (.mcp.json): ${result.mcpConfigured ? "\u2713 configured" : "\u2717 missing"}`,
		);
		if (result.environment === "claude-code") {
			deps.log.message(
				`  Claude Settings: ${result.claudeSettingsCreated ? "\u2713 created" : "\u2713 already configured"}`,
			);
		}
		if (result.doctorResult) {
			const available = result.doctorResult.tools.filter(
				(t) => t.available,
			).length;
			deps.log.message(
				`  Tools:           ${available}/${result.doctorResult.tools.length} available`,
			);
		}
		deps.log.message(
			`  Wiki:            ${result.wikiInitialized ? "\u2713 initialized" : "\u2014 not initialized"}`,
		);

		deps.log.message("");
		deps.log.step("Next steps:");
		deps.log.message("  1. Review .maina/constitution.md");
		deps.log.message("  2. Run `maina verify` on your next commit");
		if (!result.wikiInitialized) {
			deps.log.message(
				"  3. Run `maina wiki init` to compile codebase knowledge",
			);
		}
	}

	return result;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function setupCommand(): Command {
	return new Command("setup")
		.description("Guided first-time setup for Maina")
		.option("--json", "Output JSON for CI")
		.option("-y, --yes", "Skip prompts, use defaults")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina setup");
			}

			const result = await setupAction({
				json: jsonMode,
				yes: options.yes,
			});

			if (jsonMode) {
				outputJson(result, EXIT_PASSED);
			} else {
				outro("Setup complete!");
			}
		});
}
