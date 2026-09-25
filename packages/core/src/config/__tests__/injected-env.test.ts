/**
 * Issue #291: config reads the environment through an injected `EnvPort`
 * and resolves the config file from an explicit root, never from the
 * ambient `process.env` / `process.cwd()`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeEnv } from "../../ports/testing";
import {
	findConfigFile,
	getApiKey,
	getDefaultConfig,
	isHostMode,
	loadConfigModule,
	resolveProvider,
	shouldDelegateToHost,
} from "../index";

const LEAK_VARS = {
	MAINA_API_KEY: "leaked-maina-key",
	OPENROUTER_API_KEY: "leaked-openrouter-key",
	ANTHROPIC_API_KEY: "leaked-anthropic-key",
	MAINA_PROVIDER: "leaked-provider",
	MAINA_HOST_MODE: "true",
	CLAUDECODE: "1",
} as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	// Poison the ambient environment: any read of process.env shows up as a
	// wrong answer below.
	saved = {};
	for (const [key, value] of Object.entries(LEAK_VARS)) {
		saved[key] = process.env[key];
		process.env[key] = value;
	}
});

afterEach(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("config with an injected env", () => {
	test("getApiKey reads only the injected env", () => {
		expect(getApiKey(createFakeEnv())).toBeNull();
		expect(getApiKey(createFakeEnv({ OPENROUTER_API_KEY: "or-key" }))).toBe(
			"or-key",
		);
		expect(
			getApiKey(
				createFakeEnv({ MAINA_API_KEY: "m-key", OPENROUTER_API_KEY: "or" }),
			),
		).toBe("m-key");
	});

	test("isHostMode reads only the injected env", () => {
		expect(isHostMode(createFakeEnv())).toBe(false);
		expect(isHostMode(createFakeEnv({ CLAUDECODE: "1" }))).toBe(true);
		expect(isHostMode(createFakeEnv({ ANTHROPIC_API_KEY: "sk" }))).toBe(true);
	});

	test("resolveProvider reads only the injected env", () => {
		const config = getDefaultConfig();
		expect(resolveProvider(config, createFakeEnv())).toBe("openrouter");
		expect(
			resolveProvider(config, createFakeEnv({ MAINA_PROVIDER: "ollama" })),
		).toBe("ollama");
		expect(
			resolveProvider(config, createFakeEnv({ ANTHROPIC_API_KEY: "sk" })),
		).toBe("anthropic");
	});

	test("shouldDelegateToHost reads only the injected env", () => {
		expect(shouldDelegateToHost(createFakeEnv())).toBe(false);
		expect(shouldDelegateToHost(createFakeEnv({ CLAUDECODE: "1" }))).toBe(true);
		expect(
			shouldDelegateToHost(
				createFakeEnv({ CLAUDECODE: "1", MAINA_API_KEY: "k" }),
			),
		).toBe(false);
	});
});

describe("config file lookup from an explicit root", () => {
	const root = join(tmpdir(), `maina-291-config-${Date.now()}`);

	beforeEach(() => {
		mkdirSync(join(root, "nested", "deeper"), { recursive: true });
		writeFileSync(
			join(root, "maina.config.ts"),
			'export default { provider: "from-root" };\n',
		);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("findConfigFile walks up from the given root", () => {
		expect(findConfigFile(join(root, "nested", "deeper"))).toBe(
			join(root, "maina.config.ts"),
		);
	});

	test("loadConfig merges the config found from the given root", async () => {
		const { config } = await loadConfigModule(join(root, "nested"));
		expect(config.provider).toBe("from-root");
	});
});
