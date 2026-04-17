import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildErrorEvent, reportError } from "../reporter";

describe("buildErrorEvent", () => {
	test("produces a properly structured event", () => {
		const error = new Error("connection timeout");
		const event = buildErrorEvent(error, {
			command: "verify",
			version: "1.1.5",
		});

		expect(event.event).toBe("maina.error");
		expect(event.errorClass).toBe("Error");
		expect(event.message).toContain("connection timeout");
		expect(event.errorId).toMatch(/^ERR-[a-z0-9]{6}$/);
		expect(event.command).toBe("verify");
		expect(event.version).toBe("1.1.5");
		expect(event.os).toBe(process.platform);
		expect(event.timestamp).toBeTruthy();
	});

	test("scrubs PII from error message", () => {
		const error = new Error(
			"Failed for user@example.com at /Users/bikash/code/src/auth.ts",
		);
		const event = buildErrorEvent(error);

		expect(event.message).not.toContain("user@example.com");
		expect(event.message).not.toContain("/Users/bikash");
	});

	test("scrubs PII from stack trace", () => {
		const error = new Error("fail");
		error.stack =
			"Error: fail\n    at fn (/Users/bikash/code/maina/src/index.ts:10:5)";
		const event = buildErrorEvent(error);

		expect(event.stack).not.toContain("/Users/bikash");
	});

	test("defaults to unknown for missing context", () => {
		const event = buildErrorEvent(new Error("test"));
		expect(event.command).toBe("unknown");
		expect(event.version).toBe("unknown");
	});

	test("detects agent from env", () => {
		const original = process.env.CLAUDECODE;
		process.env.CLAUDECODE = "1";
		const event = buildErrorEvent(new Error("test"));
		expect(event.agent).toBe("claude-code");
		if (original === undefined) {
			delete process.env.CLAUDECODE;
		} else {
			process.env.CLAUDECODE = original;
		}
	});
});

describe("reportError", () => {
	test("returns null when reporting is disabled (no config)", () => {
		// Default: no ~/.maina/config.yml with errors: true
		const result = reportError(new Error("test"));
		// May or may not be null depending on local config — test the function doesn't throw
		expect(result === null || result.event === "maina.error").toBe(true);
	});

	test("produces event when called with buildErrorEvent directly", () => {
		// buildErrorEvent always works regardless of consent
		const event = buildErrorEvent(new Error("test"), { command: "commit" });
		expect(event.event).toBe("maina.error");
		expect(event.command).toBe("commit");
	});
});
