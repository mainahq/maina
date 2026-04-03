import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findConfigFile,
	getApiKey,
	getDefaultConfig,
	isHostMode,
	loadConfig,
	resolveProvider,
} from "../index";

// ─── getDefaultConfig ────────────────────────────────────────────────────────

describe("getDefaultConfig", () => {
	test("returns a config with all required top-level fields", () => {
		const config = getDefaultConfig();
		expect(config).toHaveProperty("models");
		expect(config).toHaveProperty("provider");
		expect(config).toHaveProperty("budget");
	});

	test("models has all four required keys", () => {
		const { models } = getDefaultConfig();
		expect(models).toHaveProperty("mechanical");
		expect(models).toHaveProperty("standard");
		expect(models).toHaveProperty("architectural");
		expect(models).toHaveProperty("local");
	});

	test("budget has daily, perTask, and alertAt", () => {
		const { budget } = getDefaultConfig();
		expect(budget).toHaveProperty("daily");
		expect(budget).toHaveProperty("perTask");
		expect(budget).toHaveProperty("alertAt");
	});

	test("returns a copy — mutations do not affect subsequent calls", () => {
		const first = getDefaultConfig();
		first.provider = "mutated";
		const second = getDefaultConfig();
		expect(second.provider).toBe("openrouter");
	});

	test("default provider is openrouter", () => {
		expect(getDefaultConfig().provider).toBe("openrouter");
	});

	test("default daily budget is 5.0", () => {
		expect(getDefaultConfig().budget.daily).toBe(5.0);
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

describe("loadConfig", () => {
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

	test("returns defaults when no config file is found", async () => {
		const config = await loadConfig(tmpDir);
		const defaults = getDefaultConfig();
		expect(config.provider).toBe(defaults.provider);
		expect(config.budget.daily).toBe(defaults.budget.daily);
		expect(config.models.standard).toBe(defaults.models.standard);
	});

	test("merges a partial config with defaults", async () => {
		const configPath = join(tmpDir, "maina.config.js");
		// CJS: module.exports becomes mod.default when dynamically imported
		writeFileSync(
			configPath,
			`module.exports = { provider: "custom-provider" };`,
		);
		const config = await loadConfig(tmpDir);
		expect(config.provider).toBe("custom-provider");
		// Defaults are preserved for unspecified fields
		expect(config.budget.daily).toBe(5.0);
		expect(config.models.standard).toBe("anthropic/claude-sonnet-4");
	});

	test("never throws — returns defaults on any import error", async () => {
		// Point at an empty temp dir where no config exists
		const emptyDir = join(tmpDir, "empty");
		mkdirSync(emptyDir, { recursive: true });
		const config = await loadConfig(emptyDir);
		expect(config).toBeDefined();
		expect(config.provider).toBe("openrouter");
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

		const result = getApiKey();

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

		const result = getApiKey();

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

		const result = getApiKey();

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

		const result = getApiKey();

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

		const result = resolveProvider(config);

		if (saved !== undefined) process.env.MAINA_PROVIDER = saved;

		expect(result).toBe("openrouter");
	});

	test("MAINA_PROVIDER env var overrides config provider", () => {
		const config = getDefaultConfig();
		const saved = process.env.MAINA_PROVIDER;
		process.env.MAINA_PROVIDER = "env-provider";

		const result = resolveProvider(config);

		if (saved !== undefined) process.env.MAINA_PROVIDER = saved;
		else delete process.env.MAINA_PROVIDER;

		expect(result).toBe("env-provider");
	});

	test("returns custom config provider when no env var", () => {
		const config = { ...getDefaultConfig(), provider: "my-custom-provider" };
		const saved = process.env.MAINA_PROVIDER;
		delete process.env.MAINA_PROVIDER;

		const result = resolveProvider(config);

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
		const result = resolveProvider(config);

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

		const result = isHostMode();

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

		const result = isHostMode();

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
			claude: process.env.CLAUDE_CODE,
			cursor: process.env.CURSOR,
		};
		delete process.env.MAINA_HOST_MODE;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.CLAUDE_CODE;
		delete process.env.CURSOR;
		process.env.MAINA_API_KEY = "test";

		const result = isHostMode();

		// Restore
		if (saved.maina !== undefined) process.env.MAINA_API_KEY = saved.maina;
		else delete process.env.MAINA_API_KEY;
		if (saved.openrouter !== undefined)
			process.env.OPENROUTER_API_KEY = saved.openrouter;
		if (saved.anthropic !== undefined)
			process.env.ANTHROPIC_API_KEY = saved.anthropic;
		if (saved.hostMode !== undefined)
			process.env.MAINA_HOST_MODE = saved.hostMode;
		if (saved.claude !== undefined) process.env.CLAUDE_CODE = saved.claude;
		if (saved.cursor !== undefined) process.env.CURSOR = saved.cursor;

		expect(result).toBe(false);
	});
});
