import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCacheKey, hashContent } from "../../cache/keys";
import { createCacheManager } from "../../cache/manager";
import { generate } from "../index";

const TEST_DIR = join(tmpdir(), `maina-ai-test-${Date.now()}`);

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeDir(sub: string): string {
	const d = join(TEST_DIR, sub);
	mkdirSync(d, { recursive: true });
	return d;
}

describe("generate — cache hit", () => {
	test("returns cached result when cache has matching entry", async () => {
		const mainaDir = makeDir("cache-hit");
		const cache = createCacheManager(mainaDir);

		const task = "commit";
		const systemPrompt = "You are a helpful assistant.";
		const userPrompt = "Write a commit message for adding tests.";
		const promptHash = hashContent(systemPrompt + userPrompt);
		const cacheKey = await buildCacheKey({
			task,
			promptHash,
			model: "google/gemini-2.5-flash",
		});

		// Pre-populate cache
		const cachedValue = JSON.stringify({
			text: "feat: add test suite",
			model: "google/gemini-2.5-flash",
			tokens: { input: 100, output: 20 },
		});
		cache.set(cacheKey, cachedValue);

		const result = await generate({
			task,
			systemPrompt,
			userPrompt,
			mainaDir,
		});

		expect(result.cached).toBe(true);
		expect(result.text).toBe("feat: add test suite");
		expect(result.model).toBe("google/gemini-2.5-flash");
	});
});

describe("generate — no API key", () => {
	test("returns helpful error message when no API key is set", async () => {
		// Ensure env vars are unset for this test
		const originalMaina = process.env.MAINA_API_KEY;
		const originalOpenRouter = process.env.OPENROUTER_API_KEY;
		delete process.env.MAINA_API_KEY;
		delete process.env.OPENROUTER_API_KEY;

		const mainaDir = makeDir("no-api-key");

		const result = await generate({
			task: "review",
			systemPrompt: "You are a code reviewer.",
			userPrompt: "Review this code: const x = 1;",
			mainaDir,
		});

		// Restore env vars
		if (originalMaina !== undefined) process.env.MAINA_API_KEY = originalMaina;
		if (originalOpenRouter !== undefined)
			process.env.OPENROUTER_API_KEY = originalOpenRouter;

		expect(result.cached).toBe(false);
		expect(result.text).toContain("API key");
		expect(result.model).toBe("");
	});
});

describe("generate — cache key construction", () => {
	test("same inputs produce same cache key (idempotent)", async () => {
		const task = "tests";
		const systemPrompt = "Generate tests.";
		const userPrompt = "Write tests for add(a, b).";
		const promptHash = hashContent(systemPrompt + userPrompt);

		const key1 = await buildCacheKey({
			task,
			promptHash,
			model: "google/gemini-2.5-flash",
		});
		const key2 = await buildCacheKey({
			task,
			promptHash,
			model: "google/gemini-2.5-flash",
		});

		expect(key1).toBe(key2);
	});

	test("different prompts produce different cache keys", async () => {
		const task = "commit";
		const promptHash1 = hashContent("system1" + "user1");
		const promptHash2 = hashContent("system2" + "user2");

		const key1 = await buildCacheKey({
			task,
			promptHash: promptHash1,
			model: "google/gemini-2.5-flash",
		});
		const key2 = await buildCacheKey({
			task,
			promptHash: promptHash2,
			model: "google/gemini-2.5-flash",
		});

		expect(key1).not.toBe(key2);
	});

	test("different tasks produce different cache keys", async () => {
		const promptHash = hashContent("system" + "user");
		const key1 = await buildCacheKey({
			task: "commit",
			promptHash,
			model: "google/gemini-2.5-flash",
		});
		const key2 = await buildCacheKey({
			task: "review",
			promptHash,
			model: "anthropic/claude-sonnet-4",
		});

		expect(key1).not.toBe(key2);
	});
});
