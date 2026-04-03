import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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
	models: {
		mechanical: "google/gemini-2.5-flash",
		standard: "anthropic/claude-sonnet-4",
		architectural: "anthropic/claude-sonnet-4",
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
 * Walks up the directory tree starting at `startDir` (defaults to
 * process.cwd()) looking for `maina.config.ts` then `maina.config.js`.
 * Returns the absolute path of the first match, or null if none found.
 */
export function findConfigFile(startDir?: string): string | null {
	let dir = startDir ?? process.cwd();
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
export async function loadConfig(startDir?: string): Promise<MainaConfig> {
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
export function getApiKey(): string | null {
	return (
		process.env.MAINA_API_KEY ??
		process.env.OPENROUTER_API_KEY ??
		process.env.ANTHROPIC_API_KEY ??
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
export function resolveProvider(config: MainaConfig): string {
	// Explicit override always wins
	if (process.env.MAINA_PROVIDER) {
		return process.env.MAINA_PROVIDER;
	}

	// Host mode auto-detection: if running inside Claude Code or similar,
	// ANTHROPIC_API_KEY is available but no explicit Maina key
	if (isHostMode()) {
		if (
			process.env.ANTHROPIC_API_KEY &&
			!process.env.MAINA_API_KEY &&
			!process.env.OPENROUTER_API_KEY
		) {
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
 * - ANTHROPIC_API_KEY without MAINA_API_KEY (Claude Code sets this)
 * - CLAUDE_CODE=1 or CURSOR=1 (host-specific env vars)
 */
export function isHostMode(): boolean {
	if (process.env.MAINA_HOST_MODE === "true") return true;
	if (process.env.CLAUDE_CODE === "1") return true;
	if (process.env.CURSOR === "1") return true;
	// Infer host mode when we have an Anthropic key but no explicit Maina config
	if (
		process.env.ANTHROPIC_API_KEY &&
		!process.env.MAINA_API_KEY &&
		!process.env.OPENROUTER_API_KEY
	) {
		return true;
	}
	return false;
}
