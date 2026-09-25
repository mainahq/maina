/**
 * Issue #291: the AI layer decides availability, host delegation and
 * provider from an injected `EnvPort` (plus an explicit root for the config
 * lookup), never from the ambient `process.env`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeEnv } from "../../ports/testing";
import { checkAIAvailability } from "../availability";
import { outputDelegationRequest } from "../delegation";
import { tryAIGenerate } from "../try-generate";

const LEAK_VARS = {
	MAINA_API_KEY: "leaked-maina-key",
	CLAUDECODE: "1",
	CLAUDE_CODE: "1",
	MAINA_HOST_MODE: "true",
} as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = {};
	for (const key of [...Object.keys(LEAK_VARS), "MAINA_MCP_SERVER"]) {
		saved[key] = process.env[key];
	}
	for (const [key, value] of Object.entries(LEAK_VARS)) {
		process.env[key] = value;
	}
	delete process.env.MAINA_MCP_SERVER;
});

afterEach(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("checkAIAvailability with an injected env", () => {
	test("reports none when the injected env has no key and no host", () => {
		expect(checkAIAvailability(createFakeEnv()).method).toBe("none");
	});

	test("reports api-key / host-delegation from the injected env", () => {
		expect(
			checkAIAvailability(createFakeEnv({ OPENROUTER_API_KEY: "k" })).method,
		).toBe("api-key");
		expect(checkAIAvailability(createFakeEnv({ CURSOR: "1" })).method).toBe(
			"host-delegation",
		);
	});
});

describe("outputDelegationRequest with an injected env", () => {
	let chunks: string[] = [];
	let original: typeof process.stderr.write;

	beforeEach(() => {
		chunks = [];
		original = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		}) as typeof process.stderr.write;
	});

	afterEach(() => {
		process.stderr.write = original;
	});

	const req = {
		task: "review",
		context: "c",
		prompt: "p",
		expectedFormat: "json" as const,
	};

	test("stays silent when the injected env is not an AI tool", () => {
		outputDelegationRequest(req, createFakeEnv());
		expect(chunks).toEqual([]);
	});

	test("writes when the injected env is an AI tool", () => {
		outputDelegationRequest(req, createFakeEnv({ CLAUDE_CODE: "1" }));
		expect(chunks.join("")).toContain("---MAINA_AI_REQUEST---");
	});

	test("stays silent in MCP mode per the injected env", () => {
		outputDelegationRequest(
			req,
			createFakeEnv({ CLAUDE_CODE: "1", MAINA_MCP_SERVER: "1" }),
		);
		expect(chunks).toEqual([]);
	});
});

describe("tryAIGenerate with an injected env", () => {
	test("is unavailable when the injected env has no key and no host", async () => {
		const root = join(tmpdir(), "maina-291-ai-no-config");
		const result = await tryAIGenerate(
			"commit",
			join(root, ".maina"),
			{},
			"diff",
			{ root, env: createFakeEnv() },
		);
		expect(result).toEqual({
			text: null,
			fromAI: false,
			hostDelegation: false,
		});
	});
});
