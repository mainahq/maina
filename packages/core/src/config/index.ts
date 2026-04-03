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
 * over OPENROUTER_API_KEY.  Returns null when neither is set.
 */
export function getApiKey(): string | null {
	return process.env.MAINA_API_KEY ?? process.env.OPENROUTER_API_KEY ?? null;
}

/**
 * Resolves the active provider, allowing the MAINA_PROVIDER environment
 * variable to override whatever is in the config.
 */
export function resolveProvider(config: MainaConfig): string {
	return process.env.MAINA_PROVIDER ?? config.provider;
}
