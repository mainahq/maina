import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EnvPort } from "../ports/env";

export interface MainaConfig {
	models: {
		mechanical: string;
		standard: string;
		architectural: string;
		local: string;
	};
	provider: string;
	budget: {
		daily: number;
		perTask: number;
		alertAt: number;
	};
	apiKey?: string;
}

const DEFAULT_CONFIG: MainaConfig = {
	// Defaults lock to the current-generation Claude 4.X family (April 2026):
	// - mechanical → Haiku 4.5 (cheap + fast, same-provider as the other tiers
	//   so one key covers every call; replaces Gemini 2.5 Flash as the cheap
	//   default — Gemini can still be set per-tier via `maina.config.ts`).
	// - standard → Sonnet 4.6 (replaces Sonnet 4 from May 2025).
	// - architectural → Opus 4.7 (actual top tier, not a clone of standard).
	//   The earlier default aliased architectural to the same Sonnet 4 as
	//   standard, which silently downgraded `maina design-review`, `learn`,
	//   and architecture work to a mid-tier model.
	models: {
		mechanical: "anthropic/claude-haiku-4-5",
		standard: "anthropic/claude-sonnet-4-6",
		architectural: "anthropic/claude-opus-4-7",
		local: "ollama/qwen3-coder-8b",
	},
	provider: "openrouter",
	budget: {
		daily: 5.0,
		perTask: 0.5,
		alertAt: 0.8,
	},
};

/**
 * Returns a deep copy of the default config so callers cannot mutate the
 * internal defaults.
 */
export function getDefaultConfig(): MainaConfig {
	return {
		...DEFAULT_CONFIG,
		models: { ...DEFAULT_CONFIG.models },
		budget: { ...DEFAULT_CONFIG.budget },
	};
}

/**
 * Walks up the directory tree starting at the explicit `startDir` (the
 * repository root or a directory inside it) looking for `maina.config.ts`
 * then `maina.config.js`. Returns the path of the first match, or null if
 * none found.
 */
export function findConfigFile(startDir: string): string | null {
	let dir = startDir;
	const names = ["maina.config.ts", "maina.config.js"];

	while (true) {
		for (const name of names) {
			const candidate = join(dir, name);
			if (existsSync(candidate)) {
				return candidate;
			}
		}

		const parent = dirname(dir);
		// Reached filesystem root — stop
		if (parent === dir) {
			return null;
		}
		dir = parent;
	}
}

/**
 * Finds and dynamically imports the maina config file, then deep-merges it
 * with the defaults.  Falls back to defaults silently on any error.
 */
export async function loadConfig(startDir: string): Promise<MainaConfig> {
	const configPath = findConfigFile(startDir);

	if (configPath === null) {
		return getDefaultConfig();
	}

	try {
		const mod = await import(configPath);
		const userConfig: Partial<MainaConfig> = mod.default ?? mod;
		return { ...DEFAULT_CONFIG, ...userConfig };
	} catch {
		return getDefaultConfig();
	}
}

/**
 * Returns the API key from environment variables, preferring MAINA_API_KEY
 * over OPENROUTER_API_KEY.  When MAINA_HOST_MODE is set, also checks for
 * ANTHROPIC_API_KEY (set by Claude Code and similar host agents).
 * Returns null when no key is found.
 */
export function getApiKey(env: EnvPort): string | null {
	return (
		env.get("MAINA_API_KEY") ??
		env.get("OPENROUTER_API_KEY") ??
		env.get("ANTHROPIC_API_KEY") ??
		null
	);
}

/**
 * Resolves the active provider, allowing the MAINA_PROVIDER environment
 * variable to override whatever is in the config.
 *
 * When running in host mode (MAINA_HOST_MODE=true or ANTHROPIC_API_KEY is set
 * without explicit provider), auto-detects the appropriate provider:
 * - ANTHROPIC_API_KEY → "anthropic"
 * - Otherwise → config default
 */
export function resolveProvider(config: MainaConfig, env: EnvPort): string {
	// Explicit override always wins
	const override = env.get("MAINA_PROVIDER");
	if (override) {
		return override;
	}

	// Host mode auto-detection: if running inside Claude Code or similar,
	// ANTHROPIC_API_KEY is available but no explicit Maina key
	if (isHostMode(env)) {
		if (onlyAnthropicKey(env)) {
			return "anthropic";
		}
	}

	return config.provider;
}

/**
 * Detect if Maina is running inside a host agent environment
 * (e.g., Claude Code, Cursor, Codex).
 *
 * Checks for:
 * - MAINA_HOST_MODE=true (explicit opt-in)
 * - CLAUDECODE=1 (Claude Code sets this — note: no underscore)
 * - CLAUDE_CODE_ENTRYPOINT (Claude Code sets this to "cli")
 * - CURSOR=1 (Cursor sets this)
 * - ANTHROPIC_API_KEY without MAINA_API_KEY
 */
export function isHostMode(env: EnvPort): boolean {
	if (env.get("MAINA_HOST_MODE") === "true") return true;
	// Claude Code sets CLAUDECODE=1 (no underscore) and CLAUDE_CODE_ENTRYPOINT
	if (env.get("CLAUDECODE") === "1") return true;
	if (env.get("CLAUDE_CODE_ENTRYPOINT")) return true;
	if (env.get("CURSOR") === "1") return true;
	// Infer host mode when we have an Anthropic key but no explicit Maina config
	return onlyAnthropicKey(env);
}

/** An Anthropic key is present without an explicit Maina/OpenRouter key. */
function onlyAnthropicKey(env: EnvPort): boolean {
	return Boolean(
		env.get("ANTHROPIC_API_KEY") &&
			!env.get("MAINA_API_KEY") &&
			!env.get("OPENROUTER_API_KEY"),
	);
}

/**
 * Check if AI should be delegated to host instead of direct API call.
 *
 * NOTE: In practice this currently returns true only when MAINA_HOST_MODE=true
 * is set explicitly with no API keys. The common Claude Code scenario
 * (CLAUDECODE=1 without API keys) triggers isHostMode() but also triggers
 * this function's delegation. The generate() function handles this by
 * returning a [HOST_DELEGATION] prompt string.
 */
export function shouldDelegateToHost(env: EnvPort): boolean {
	if (!isHostMode(env)) return false;
	// If user has their own API key, use it directly
	if (env.get("MAINA_API_KEY") || env.get("OPENROUTER_API_KEY")) return false;
	if (env.get("ANTHROPIC_API_KEY")) return false;
	// In host mode with no key — delegate to host agent
	return true;
}
