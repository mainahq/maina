import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { checkAIAvailability } from "../availability";

describe("checkAIAvailability", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clear all relevant env vars before each test
		delete process.env.MAINA_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.MAINA_HOST_MODE;
		delete process.env.CLAUDECODE;
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		delete process.env.CURSOR;
	});

	afterEach(() => {
		// Restore original env
		for (const key of [
			"MAINA_API_KEY",
			"OPENROUTER_API_KEY",
			"ANTHROPIC_API_KEY",
			"MAINA_HOST_MODE",
			"CLAUDECODE",
			"CLAUDE_CODE_ENTRYPOINT",
			"CURSOR",
		]) {
			if (originalEnv[key] !== undefined) {
				process.env[key] = originalEnv[key];
			} else {
				delete process.env[key];
			}
		}
	});

	it("returns api-key method when MAINA_API_KEY is set", () => {
		process.env.MAINA_API_KEY = "test-key-123";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("api-key");
		expect(result.reason).toBeUndefined();
	});

	it("returns api-key method when OPENROUTER_API_KEY is set", () => {
		process.env.OPENROUTER_API_KEY = "or-key-456";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("api-key");
		expect(result.reason).toBeUndefined();
	});

	it("returns api-key method when ANTHROPIC_API_KEY is set", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("api-key");
		expect(result.reason).toBeUndefined();
	});

	it("returns host-delegation when CLAUDECODE env is set", () => {
		process.env.CLAUDECODE = "1";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("host-delegation");
		expect(result.reason).toBeUndefined();
	});

	it("returns host-delegation when CLAUDE_CODE_ENTRYPOINT is set", () => {
		process.env.CLAUDE_CODE_ENTRYPOINT = "cli";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("host-delegation");
		expect(result.reason).toBeUndefined();
	});

	it("returns host-delegation when CURSOR is set", () => {
		process.env.CURSOR = "1";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("host-delegation");
		expect(result.reason).toBeUndefined();
	});

	it("returns host-delegation when MAINA_HOST_MODE is true", () => {
		process.env.MAINA_HOST_MODE = "true";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("host-delegation");
		expect(result.reason).toBeUndefined();
	});

	it("returns none when no key and no host environment", () => {
		const result = checkAIAvailability();

		expect(result.available).toBe(false);
		expect(result.method).toBe("none");
	});

	it("includes a reason message when method is none", () => {
		const result = checkAIAvailability();

		expect(result.reason).toBeDefined();
		expect(result.reason).toContain("No API key found");
		expect(result.reason).toContain("maina init");
	});

	it("prefers api-key over host-delegation when both available", () => {
		process.env.MAINA_API_KEY = "test-key";
		process.env.CLAUDECODE = "1";

		const result = checkAIAvailability();

		expect(result.available).toBe(true);
		expect(result.method).toBe("api-key");
	});
});
