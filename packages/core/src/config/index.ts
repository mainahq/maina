import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Result } from "../db/index";
import type { EnvPort } from "../ports/env";
import type { CorePorts } from "../ports/index";
import {
	type Config,
	type ConfigError,
	mergeConfig,
	parseConfigLayer,
	readJsonFile,
	salvageConfigLayer,
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A 1.x `models` block without the removed, never-implemented `local` tier. */
function withoutLocalTier(models: unknown): unknown {
	if (!isRecord(models)) return models;
	const { local: _local, ...routed } = models;
	return routed;
}

/**
 * Maps a 1.x `maina.config.ts` export onto the current file shape: the
 * unenforced `budget.daily/perTask/alertAt` become `dailyUsd/perTaskUsd`,
 * the never-read `apiKey` is dropped (keys come from the environment) and
 * so is the unimplemented `models.local` tier (#334).
 */
function fromLegacyModule(raw: unknown): unknown {
	// Anything but a plain record (arrays included) passes through untouched
	// so validation reports it instead of the spread hiding it.
	if (!isRecord(raw)) return raw;
	const { apiKey: _apiKey, budget, models, ...others } = raw;
	const rest =
		models === undefined
			? others
			: { ...others, models: withoutLocalTier(models) };
	if (!isRecord(budget)) {
		return budget === undefined ? rest : { ...rest, budget };
	}
	const { daily, perTask, alertAt: _alertAt, ...current } = budget;
	return {
		...rest,
		budget: {
			...(daily === undefined ? {} : { dailyUsd: daily }),
			...(perTask === undefined ? {} : { perTaskUsd: perTask }),
			...current,
		},
	};
}

/** What {@link loadConfigModule} resolved, and every field it had to drop. */
export type ConfigModuleLoad = Readonly<{
	config: Config;
	/** One entry per dropped field (with its path) or per unloadable file. */
	errors: readonly ConfigError[];
}>;

/**
 * 1.x loader: finds and dynamically imports `maina.config.{ts,js}`, then
 * validates it and merges it over the defaults with the same defined merge
 * as {@link loadConfig}. Never throws and never silently resets (#393): an
 * invalid field is dropped on its own and reported in `errors` while every
 * valid field is kept; a module that cannot be imported or read yields the
 * defaults plus a `parse` error for that file.
 */
export async function loadConfigModule(
	startDir: string,
): Promise<ConfigModuleLoad> {
	const configPath = findConfigFile(startDir);

	if (configPath === null) {
		return { config: getDefaultConfig(), errors: [] };
	}

	// Importing runs user code, and reading the export can too (getters), so
	// both stay inside the guard.
	try {
		const mod = (await import(configPath)) as { default?: unknown };
		const { layer, errors } = salvageConfigLayer(
			// Presence, not nullishness: `export default null` is a (bad) root value.
			fromLegacyModule(Object.hasOwn(mod, "default") ? mod.default : mod),
			configPath,
		);
		return { config: mergeConfig(getDefaultConfig(), layer), errors };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			config: getDefaultConfig(),
			errors: [
				{
					kind: "parse",
					file: configPath,
					path: "",
					message: `Could not load the config module: ${reason}`,
				},
			],
		};
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
export function resolveProvider(
	config: Pick<Config, "provider">,
	env: EnvPort,
): string {
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
