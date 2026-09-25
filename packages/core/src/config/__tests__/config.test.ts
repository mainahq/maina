import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvPort } from "../../ports/env";
import {
	findConfigFile,
	getApiKey,
	getDefaultConfig,
	isHostMode,
	loadConfigModule,
	resolveProvider,
} from "../index";

/** Live view of the test process env (tests toggle process.env directly). */
const liveEnv: EnvPort = { get: (name) => process.env[name] };

// ─── getDefaultConfig ────────────────────────────────────────────────────────

describe("getDefaultConfig", () => {
	test("returns a config with all required top-level fields", () => {
		const config = getDefaultConfig();
		expect(config).toHaveProperty("models");
		expect(config).toHaveProperty("provider");
		expect(config).toHaveProperty("budget");
	});

	test("models has exactly the three routed tiers", () => {
		const { models } = getDefaultConfig();
		expect(Object.keys(models).sort()).toEqual([
			"architectural",
			"mechanical",
			"standard",
		]);
	});

	test("budget has dailyUsd, perTaskUsd, and onBreach", () => {
		const { budget } = getDefaultConfig();
		expect(budget).toHaveProperty("dailyUsd");
		expect(budget).toHaveProperty("perTaskUsd");
		expect(budget).toHaveProperty("onBreach");
	});

	test("returns a copy — mutations do not affect subsequent calls", () => {
		const first = getDefaultConfig();
		(first as { provider: string }).provider = "mutated";
		const second = getDefaultConfig();
		expect(second.provider).toBe("openrouter");
	});

	test("default provider is openrouter", () => {
		expect(getDefaultConfig().provider).toBe("openrouter");
	});

	test("default tier models are Claude 4.X (not legacy Sonnet 4)", () => {
		const { models } = getDefaultConfig();
		// Locked to the current-gen family. Upgrading these is a deliberate
		// change — when the next family ships, this test forces you to
		// update DEFAULT_CONFIG instead of silently drifting.
		expect(models.mechanical).toBe("anthropic/claude-haiku-4-5");
		expect(models.standard).toBe("anthropic/claude-sonnet-4-6");
		expect(models.architectural).toBe("anthropic/claude-opus-4-7");
	});

	test("architectural tier is distinct from standard (not a regression clone)", () => {
		const { models } = getDefaultConfig();
		expect(models.architectural).not.toBe(models.standard);
	});

	test("default daily budget is 5.0", () => {
		expect(getDefaultConfig().budget.dailyUsd).toBe(5.0);
	});
});

// ─── findConfigFile ───────────────────────────────────────────────────────────

describe("findConfigFile", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`maina-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns null when no config file exists", () => {
		const result = findConfigFile(tmpDir);
		expect(result).toBeNull();
	});

	test("finds maina.config.ts in the start directory", () => {
		const configPath = join(tmpDir, "maina.config.ts");
		writeFileSync(configPath, "export default {};");
		const result = findConfigFile(tmpDir);
		expect(result).toBe(configPath);
	});

	test("finds maina.config.js in the start directory", () => {
		const configPath = join(tmpDir, "maina.config.js");
		writeFileSync(configPath, "module.exports = {};");
		const result = findConfigFile(tmpDir);
		expect(result).toBe(configPath);
	});

	test("finds config in a parent directory", () => {
		const subDir = join(tmpDir, "nested", "deep");
		mkdirSync(subDir, { recursive: true });
		const configPath = join(tmpDir, "maina.config.ts");
		writeFileSync(configPath, "export default {};");
		const result = findConfigFile(subDir);
		expect(result).toBe(configPath);
	});

	test("prefers maina.config.ts over maina.config.js when both exist", () => {
		const tsPath = join(tmpDir, "maina.config.ts");
		const jsPath = join(tmpDir, "maina.config.js");
		writeFileSync(tsPath, "export default {};");
		writeFileSync(jsPath, "module.exports = {};");
		const result = findConfigFile(tmpDir);
		expect(result).toBe(tsPath);
	});
});

// ─── loadConfig ──────────────────────────────────────────────────────────────

describe("loadConfigModule", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`maina-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeModule(body: string): string {
		const configPath = join(tmpDir, "maina.config.js");
		// CJS: module.exports becomes mod.default when dynamically imported
		writeFileSync(configPath, `module.exports = ${body};`);
		return configPath;
	}

	test("returns defaults and no errors when no config file is found", async () => {
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config).toEqual(getDefaultConfig());
		expect(errors).toEqual([]);
	});

	test("merges a partial config with defaults", async () => {
		writeModule(`{ provider: "custom-provider" }`);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(errors).toEqual([]);
		expect(config.provider).toBe("custom-provider");
		// Defaults are preserved for unspecified fields
		expect(config.budget.dailyUsd).toBe(5.0);
		expect(config.models.standard).toBe("anthropic/claude-sonnet-4-6");
	});

	test("merges nested objects instead of replacing them", async () => {
		writeModule(`{ models: { standard: "x/custom" } }`);
		const { config } = await loadConfigModule(tmpDir);
		expect(config.models.standard).toBe("x/custom");
		expect(config.models.mechanical).toBe("anthropic/claude-haiku-4-5");
	});

	test("maps the 1.x budget keys onto the enforceable budget", async () => {
		writeModule(
			`{ apiKey: "sk-x", budget: { daily: 9, perTask: 1, alertAt: 0.5 } }`,
		);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(errors).toEqual([]);
		expect(config.budget).toEqual({
			dailyUsd: 9,
			perTaskUsd: 1,
			onBreach: "degrade",
		});
		expect("apiKey" in config).toBe(false);
	});

	// #334: the unimplemented `local` tier is gone; a 1.x config that still
	// names it keeps loading without an error.
	test("drops the removed 1.x local tier without reporting it", async () => {
		writeModule(
			`{ models: { standard: "x/custom", local: "ollama/qwen3-coder-8b" } }`,
		);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(errors).toEqual([]);
		expect(config.models.standard).toBe("x/custom");
		expect("local" in config.models).toBe(false);
	});

	// #393: one bad key must never reset the whole user config.
	test("keeps the custom provider and models when an unknown key is present, and reports it", async () => {
		const file = writeModule(
			`{ provider: "custom-provider", models: { standard: "x/custom" }, bogus: true }`,
		);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config.provider).toBe("custom-provider");
		expect(config.models.standard).toBe("x/custom");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ kind: "invalid", file, path: "bogus" });
		expect(errors[0]?.message).toContain("bogus");
	});

	test("drops only the invalid nested field and keeps its valid siblings", async () => {
		writeModule(
			`{ provider: "custom-provider", models: { standard: 42, mechanical: "x/cheap" }, budget: { dailyUsd: 7, extra: 1 } }`,
		);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config.provider).toBe("custom-provider");
		expect(config.models.mechanical).toBe("x/cheap");
		expect(config.models.standard).toBe("anthropic/claude-sonnet-4-6");
		expect(config.budget.dailyUsd).toBe(7);
		expect(errors.map((e) => e.path).sort()).toEqual([
			"budget.extra",
			"models.standard",
		]);
	});

	test("reports every invalid field with its path, not just the first", async () => {
		writeModule(
			`{ provider: 42, budget: { onBreach: "explode" }, repoAliases: { web: "not a slug", api: "acme/api" }, modles: {} }`,
		);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config.provider).toBe("openrouter");
		expect(config.budget.onBreach).toBe("degrade");
		expect(config.repoAliases).toEqual({ api: "acme/api" });
		expect(errors.map((e) => e.path).sort()).toEqual([
			"budget.onBreach",
			"modles",
			"provider",
			"repoAliases.web",
		]);
		for (const error of errors) {
			expect(error.kind).toBe("invalid");
			expect(error.message.length).toBeGreaterThan(0);
		}
	});

	test("reports a non-object export at the root and falls back to the defaults", async () => {
		writeModule("42");
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config).toEqual(getDefaultConfig());
		expect(errors).toHaveLength(1);
		expect(errors[0]?.path).toBe("");
	});

	// Review of #397: a null default export is a non-object root, not a
	// missing default (which would surface as an unknown `default` key).
	test("reports a null default export as a root error, not an unknown `default` key", async () => {
		writeModule("null");
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config).toEqual(getDefaultConfig());
		expect(errors).toHaveLength(1);
		expect(errors[0]?.path).toBe("");
	});

	// Review of #397: the legacy normaliser must not spread an array into an
	// object, which made `[]` look like a valid empty config.
	test.each([
		"[]",
		`["provider"]`,
	])("reports an array export (%s) as a root error", async (body) => {
		writeModule(body);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config).toEqual(getDefaultConfig());
		expect(errors).toHaveLength(1);
		expect(errors[0]?.path).toBe("");
	});

	test("reports an array budget instead of normalising it to an empty one", async () => {
		writeModule(`{ provider: "custom-provider", budget: [] }`);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config.provider).toBe("custom-provider");
		expect(errors.map((e) => e.path)).toEqual(["budget"]);
	});

	// Review of #397: the "never throws" contract covers reading the export
	// too, since the CLI calls this before every command.
	test("reports an export whose fields throw when read instead of throwing", async () => {
		const file = writeModule(`{ get provider() { throw new Error("boom"); } }`);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config).toEqual(getDefaultConfig());
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ kind: "parse", file, path: "" });
		expect(errors[0]?.message).toContain("boom");
	});

	test("reads named exports when the module has no default export", async () => {
		writeFileSync(
			join(tmpDir, "maina.config.ts"),
			`export const provider = "named-provider";`,
		);
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(errors).toEqual([]);
		expect(config.provider).toBe("named-provider");
	});

	test("reports a module that fails to import instead of swallowing it", async () => {
		const configPath = join(tmpDir, "maina.config.js");
		writeFileSync(configPath, "module.exports = { provider: ;");
		const { config, errors } = await loadConfigModule(tmpDir);
		expect(config).toEqual(getDefaultConfig());
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			kind: "parse",
			file: configPath,
			path: "",
		});
	});
});

// ─── getApiKey ────────────────────────────────────────────────────────────────

describe("getApiKey", () => {
	test("returns null when neither env var is set", () => {
		// Temporarily unset both vars for isolation
		const saved1 = process.env.MAINA_API_KEY;
		const saved2 = process.env.OPENROUTER_API_KEY;
		delete process.env.MAINA_API_KEY;
		delete process.env.OPENROUTER_API_KEY;

		const result = getApiKey(liveEnv);

		// Restore
		if (saved1 !== undefined) process.env.MAINA_API_KEY = saved1;
		if (saved2 !== undefined) process.env.OPENROUTER_API_KEY = saved2;

		expect(result).toBeNull();
	});

	test("returns MAINA_API_KEY when set", () => {
		const saved1 = process.env.MAINA_API_KEY;
		const saved2 = process.env.OPENROUTER_API_KEY;
		process.env.MAINA_API_KEY = "test-maina-key";
		delete process.env.OPENROUTER_API_KEY;

		const result = getApiKey(liveEnv);

		if (saved1 !== undefined) process.env.MAINA_API_KEY = saved1;
		else delete process.env.MAINA_API_KEY;
		if (saved2 !== undefined) process.env.OPENROUTER_API_KEY = saved2;

		expect(result).toBe("test-maina-key");
	});

	test("returns OPENROUTER_API_KEY when MAINA_API_KEY is not set", () => {
		const saved1 = process.env.MAINA_API_KEY;
		const saved2 = process.env.OPENROUTER_API_KEY;
		delete process.env.MAINA_API_KEY;
		process.env.OPENROUTER_API_KEY = "test-openrouter-key";

		const result = getApiKey(liveEnv);

		if (saved1 !== undefined) process.env.MAINA_API_KEY = saved1;
		if (saved2 !== undefined) process.env.OPENROUTER_API_KEY = saved2;
		else delete process.env.OPENROUTER_API_KEY;

		expect(result).toBe("test-openrouter-key");
	});

	test("MAINA_API_KEY takes precedence over OPENROUTER_API_KEY", () => {
		const saved1 = process.env.MAINA_API_KEY;
		const saved2 = process.env.OPENROUTER_API_KEY;
		process.env.MAINA_API_KEY = "maina-wins";
		process.env.OPENROUTER_API_KEY = "openrouter-loses";

		const result = getApiKey(liveEnv);

		if (saved1 !== undefined) process.env.MAINA_API_KEY = saved1;
		else delete process.env.MAINA_API_KEY;
		if (saved2 !== undefined) process.env.OPENROUTER_API_KEY = saved2;
		else delete process.env.OPENROUTER_API_KEY;

		expect(result).toBe("maina-wins");
	});
});

// ─── resolveProvider ─────────────────────────────────────────────────────────

describe("resolveProvider", () => {
	test("returns config provider by default", () => {
		const config = getDefaultConfig();
		const saved = process.env.MAINA_PROVIDER;
		delete process.env.MAINA_PROVIDER;

		const result = resolveProvider(config, liveEnv);

		if (saved !== undefined) process.env.MAINA_PROVIDER = saved;

		expect(result).toBe("openrouter");
	});

	test("MAINA_PROVIDER env var overrides config provider", () => {
		const config = getDefaultConfig();
		const saved = process.env.MAINA_PROVIDER;
		process.env.MAINA_PROVIDER = "env-provider";

		const result = resolveProvider(config, liveEnv);

		if (saved !== undefined) process.env.MAINA_PROVIDER = saved;
		else delete process.env.MAINA_PROVIDER;

		expect(result).toBe("env-provider");
	});

	test("returns custom config provider when no env var", () => {
		const config = { ...getDefaultConfig(), provider: "my-custom-provider" };
		const saved = process.env.MAINA_PROVIDER;
		delete process.env.MAINA_PROVIDER;

		const result = resolveProvider(config, liveEnv);

		if (saved !== undefined) process.env.MAINA_PROVIDER = saved;

		expect(result).toBe("my-custom-provider");
	});

	test("auto-detects anthropic provider in host mode", () => {
		const saved = {
			provider: process.env.MAINA_PROVIDER,
			maina: process.env.MAINA_API_KEY,
			openrouter: process.env.OPENROUTER_API_KEY,
			anthropic: process.env.ANTHROPIC_API_KEY,
			hostMode: process.env.MAINA_HOST_MODE,
		};
		delete process.env.MAINA_PROVIDER;
		delete process.env.MAINA_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		process.env.MAINA_HOST_MODE = "true";

		const config = getDefaultConfig();
		const result = resolveProvider(config, liveEnv);

		// Restore
		if (saved.provider !== undefined)
			process.env.MAINA_PROVIDER = saved.provider;
		if (saved.maina !== undefined) process.env.MAINA_API_KEY = saved.maina;
		if (saved.openrouter !== undefined)
			process.env.OPENROUTER_API_KEY = saved.openrouter;
		if (saved.anthropic !== undefined)
			process.env.ANTHROPIC_API_KEY = saved.anthropic;
		else delete process.env.ANTHROPIC_API_KEY;
		if (saved.hostMode !== undefined)
			process.env.MAINA_HOST_MODE = saved.hostMode;
		else delete process.env.MAINA_HOST_MODE;

		expect(result).toBe("anthropic");
	});
});

// ─── isHostMode ─────────────────────────────────────────────────────────────

describe("isHostMode", () => {
	test("returns true when MAINA_HOST_MODE=true", () => {
		const saved = process.env.MAINA_HOST_MODE;
		process.env.MAINA_HOST_MODE = "true";

		const result = isHostMode(liveEnv);

		if (saved !== undefined) process.env.MAINA_HOST_MODE = saved;
		else delete process.env.MAINA_HOST_MODE;

		expect(result).toBe(true);
	});

	test("returns true when ANTHROPIC_API_KEY set without Maina keys", () => {
		const saved = {
			maina: process.env.MAINA_API_KEY,
			openrouter: process.env.OPENROUTER_API_KEY,
			anthropic: process.env.ANTHROPIC_API_KEY,
			hostMode: process.env.MAINA_HOST_MODE,
		};
		delete process.env.MAINA_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
		delete process.env.MAINA_HOST_MODE;
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";

		const result = isHostMode(liveEnv);

		if (saved.maina !== undefined) process.env.MAINA_API_KEY = saved.maina;
		if (saved.openrouter !== undefined)
			process.env.OPENROUTER_API_KEY = saved.openrouter;
		if (saved.anthropic !== undefined)
			process.env.ANTHROPIC_API_KEY = saved.anthropic;
		else delete process.env.ANTHROPIC_API_KEY;
		if (saved.hostMode !== undefined)
			process.env.MAINA_HOST_MODE = saved.hostMode;

		expect(result).toBe(true);
	});

	test("returns false when no host indicators present", () => {
		const saved = {
			maina: process.env.MAINA_API_KEY,
			openrouter: process.env.OPENROUTER_API_KEY,
			anthropic: process.env.ANTHROPIC_API_KEY,
			hostMode: process.env.MAINA_HOST_MODE,
			claude: process.env.CLAUDECODE,
			claudeEntrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
			cursor: process.env.CURSOR,
		};
		delete process.env.MAINA_HOST_MODE;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.CLAUDECODE;
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		delete process.env.CURSOR;
		process.env.MAINA_API_KEY = "test";

		const result = isHostMode(liveEnv);

		// Restore
		if (saved.maina !== undefined) process.env.MAINA_API_KEY = saved.maina;
		else delete process.env.MAINA_API_KEY;
		if (saved.openrouter !== undefined)
			process.env.OPENROUTER_API_KEY = saved.openrouter;
		if (saved.anthropic !== undefined)
			process.env.ANTHROPIC_API_KEY = saved.anthropic;
		if (saved.hostMode !== undefined)
			process.env.MAINA_HOST_MODE = saved.hostMode;
		if (saved.claude !== undefined) process.env.CLAUDECODE = saved.claude;
		if (saved.claudeEntrypoint !== undefined)
			process.env.CLAUDE_CODE_ENTRYPOINT = saved.claudeEntrypoint;
		else delete process.env.CLAUDE_CODE_ENTRYPOINT;
		if (saved.cursor !== undefined) process.env.CURSOR = saved.cursor;

		expect(result).toBe(false);
	});
});
