import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Result } from "../db/index";
import type { CorePorts } from "../ports/index";
import {
	type Config,
	type ConfigError,
	mergeConfig,
	parseConfigLayer,
	readJsonFile,
} from "./schema";

export type { ConfigError } from "./schema";

const DEFAULT_CONFIG: Config = {
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
	// Enforceable budget (#293, enforced by the router in #334): caps in USD
	// plus what to do on a breach. Replaces the 1.x `daily/perTask/alertAt`
	// shape, which nothing ever read.
	budget: {
		dailyUsd: 5.0,
		perTaskUsd: 0.5,
		onBreach: "degrade",
	},
	repoAliases: {},
};

/**
 * Returns a deep copy of the default config so callers cannot mutate the
 * internal defaults.
 */
export function getDefaultConfig(): Config {
	return {
		...DEFAULT_CONFIG,
		models: { ...DEFAULT_CONFIG.models },
		budget: { ...DEFAULT_CONFIG.budget },
		repoAliases: { ...DEFAULT_CONFIG.repoAliases },
	};
}

/**
 * Loads `<root>/.maina/config.json` through the fs port, validates it and
 * merges it over the defaults. A missing file yields the defaults; an
 * invalid one yields every violation with its path.
 */
export async function loadConfig(
	ports: Pick<CorePorts, "fs">,
	root: string,
): Promise<Result<Config, readonly ConfigError[]>> {
	const file = join(root, ".maina", "config.json");
	const raw = await readJsonFile(ports.fs, file);
	if (!raw.ok) {
		return {
			ok: false,
			error: [
				{ kind: raw.error.kind, file, path: "", message: raw.error.message },
			],
		};
	}
	if (raw.value === undefined) return { ok: true, value: getDefaultConfig() };
	const layer = parseConfigLayer(raw.value, file);
	if (!layer.ok) return layer;
	return { ok: true, value: mergeConfig(getDefaultConfig(), layer.value) };
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
 * Maps a 1.x `maina.config.ts` export onto the current file shape: the
 * unenforced `budget.daily/perTask/alertAt` become `dailyUsd/perTaskUsd`
 * and the never-read `apiKey` is dropped (keys come from the environment).
 */
function fromLegacyModule(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) return raw;
	const { apiKey: _apiKey, budget, ...rest } = raw as Record<string, unknown>;
	if (typeof budget !== "object" || budget === null) {
		return budget === undefined ? rest : { ...rest, budget };
	}
	const {
		daily,
		perTask,
		alertAt: _alertAt,
		...current
	} = budget as Record<string, unknown>;
	return {
		...rest,
		budget: {
			...(daily === undefined ? {} : { dailyUsd: daily }),
			...(perTask === undefined ? {} : { perTaskUsd: perTask }),
			...current,
		},
	};
}

/**
 * 1.x loader: finds and dynamically imports `maina.config.{ts,js}`, then
 * validates it and merges it over the defaults with the same defined merge
 * as {@link loadConfig}. Falls back to the defaults on any error.
 */
export async function loadConfigModule(startDir?: string): Promise<Config> {
	const configPath = findConfigFile(startDir);

	if (configPath === null) {
		return getDefaultConfig();
	}

	try {
		const mod = await import(configPath);
		const layer = parseConfigLayer(
			fromLegacyModule(mod.default ?? mod),
			configPath,
		);
		return layer.ok
			? mergeConfig(getDefaultConfig(), layer.value)
			: getDefaultConfig();
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
export function resolveProvider(config: Pick<Config, "provider">): string {
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
 * - CLAUDECODE=1 (Claude Code sets this — note: no underscore)
 * - CLAUDE_CODE_ENTRYPOINT (Claude Code sets this to "cli")
 * - CURSOR=1 (Cursor sets this)
 * - ANTHROPIC_API_KEY without MAINA_API_KEY
 */
export function isHostMode(): boolean {
	if (process.env.MAINA_HOST_MODE === "true") return true;
	// Claude Code sets CLAUDECODE=1 (no underscore) and CLAUDE_CODE_ENTRYPOINT
	if (process.env.CLAUDECODE === "1") return true;
	if (process.env.CLAUDE_CODE_ENTRYPOINT) return true;
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

/**
 * Check if AI should be delegated to host instead of direct API call.
 *
 * NOTE: In practice this currently returns true only when MAINA_HOST_MODE=true
 * is set explicitly with no API keys. The common Claude Code scenario
 * (CLAUDECODE=1 without API keys) triggers isHostMode() but also triggers
 * this function's delegation. The generate() function handles this by
 * returning a [HOST_DELEGATION] prompt string.
 */
export function shouldDelegateToHost(): boolean {
	if (!isHostMode()) return false;
	// If user has their own API key, use it directly
	if (process.env.MAINA_API_KEY || process.env.OPENROUTER_API_KEY) return false;
	if (process.env.ANTHROPIC_API_KEY) return false;
	// In host mode with no key — delegate to host agent
	return true;
}
