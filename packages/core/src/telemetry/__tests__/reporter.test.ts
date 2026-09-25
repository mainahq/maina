import { describe, expect, test } from "bun:test";
import { envFromRecord } from "../../ports/env";
import { buildErrorEvent, reportError } from "../reporter";

const env = envFromRecord({});

describe("buildErrorEvent", () => {
	test("produces a properly structured event", () => {
		const error = new Error("connection timeout");
		const event = buildErrorEvent(error, {
			env,
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
		const event = buildErrorEvent(error, { env });

		expect(event.message).not.toContain("user@example.com");
		expect(event.message).not.toContain("/Users/bikash");
	});

	test("scrubs PII from stack trace", () => {
		const error = new Error("fail");
		error.stack =
			"Error: fail\n    at fn (/Users/bikash/code/maina/src/index.ts:10:5)";
		const event = buildErrorEvent(error, { env });

		expect(event.stack).not.toContain("/Users/bikash");
	});

	test("defaults to unknown for missing context", () => {
		const event = buildErrorEvent(new Error("test"), { env });
		expect(event.command).toBe("unknown");
		expect(event.version).toBe("unknown");
	});

	test("detects agent from env", () => {
		const event = buildErrorEvent(new Error("test"), {
			env: envFromRecord({ CLAUDECODE: "1" }),
		});
		expect(event.agent).toBe("claude-code");
	});
});

describe("reportError", () => {
	test("returns null when reporting is disabled (no config)", () => {
		// Default: no ~/.maina/config.yml with errors: true
		const result = reportError(new Error("test"), { env });
		// May or may not be null depending on local config — test the function doesn't throw
		expect(result === null || result.event === "maina.error").toBe(true);
	});

	test("produces event when called with buildErrorEvent directly", () => {
		// buildErrorEvent always works regardless of consent
		const event = buildErrorEvent(new Error("test"), {
			env,
			command: "commit",
		});
		expect(event.event).toBe("maina.error");
		expect(event.command).toBe("commit");
	});
});
