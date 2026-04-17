import { describe, expect, test } from "bun:test";
import {
	scrubEnvValues,
	scrubErrorEvent,
	scrubFilePaths,
	scrubPersonalInfo,
	scrubPii,
	scrubSecrets,
	scrubStackTrace,
} from "../scrubber";

// ── scrubFilePaths ──────────────────────────────────────────────────────

describe("scrubFilePaths", () => {
	test("replaces macOS absolute paths", () => {
		const result = scrubFilePaths("/Users/bikash/code/maina/src/index.ts");
		expect(result).not.toContain("/Users/bikash");
		expect(result).toContain("<repo>/src/index.ts");
	});

	test("replaces Linux home paths", () => {
		const result = scrubFilePaths("/home/runner/work/maina/src/verify.ts");
		expect(result).not.toContain("/home/runner");
		expect(result).toContain("<repo>/src/verify.ts");
	});

	test("replaces Windows paths", () => {
		const result = scrubFilePaths(
			"C:\\Users\\admin\\projects\\maina\\src\\index.ts",
		);
		expect(result).not.toContain("C:\\Users\\admin");
	});

	test("handles paths without repo markers", () => {
		const result = scrubFilePaths("/Users/bikash/random/file.txt");
		expect(result).toBe("<redacted-path>");
	});

	test("preserves non-path text", () => {
		const result = scrubFilePaths("Error: something went wrong");
		expect(result).toBe("Error: something went wrong");
	});
});

// ── scrubSecrets ────────────────────────────────────────────────────────

describe("scrubSecrets", () => {
	test("redacts OpenAI API keys", () => {
		const result = scrubSecrets("key is sk-abc123def456ghi789jkl012mno345");
		expect(result).not.toContain("sk-abc123");
		expect(result).toContain("[REDACTED]");
	});

	test("redacts GitHub PATs", () => {
		const result = scrubSecrets(
			"token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
		);
		expect(result).not.toContain("ghp_");
		expect(result).toContain("[REDACTED]");
	});

	test("redacts Bearer tokens", () => {
		const result = scrubSecrets(
			"Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
		);
		expect(result).toContain("[REDACTED]");
	});

	test("preserves short strings", () => {
		const result = scrubSecrets("hello world");
		expect(result).toBe("hello world");
	});
});

// ── scrubPersonalInfo ───────────────────────────────────────────────────

describe("scrubPersonalInfo", () => {
	test("redacts email addresses", () => {
		const result = scrubPersonalInfo("Contact: bikash@example.com");
		expect(result).toContain("[EMAIL]");
		expect(result).not.toContain("bikash@example.com");
	});

	test("redacts IP addresses", () => {
		const result = scrubPersonalInfo("Client IP: 192.168.1.100");
		expect(result).toContain("[IP]");
		expect(result).not.toContain("192.168.1.100");
	});

	test("preserves localhost", () => {
		const result = scrubPersonalInfo("Server: 127.0.0.1");
		expect(result).toContain("127.0.0.1");
	});
});

// ── scrubEnvValues ──────────────────────────────────────────────────────

describe("scrubEnvValues", () => {
	test("redacts env variable values", () => {
		const result = scrubEnvValues('OPENROUTER_API_KEY="sk-real-key-123"');
		expect(result).toContain("OPENROUTER_API_KEY=[REDACTED]");
		expect(result).not.toContain("sk-real-key-123");
	});

	test("handles unquoted values", () => {
		const result = scrubEnvValues("DB_PASSWORD=supersecret123");
		expect(result).toContain("DB_PASSWORD=[REDACTED]");
	});
});

// ── scrubStackTrace ─────────────────────────────────────────────────────

describe("scrubStackTrace", () => {
	test("preserves stack structure but scrubs paths", () => {
		const stack = [
			"Error: connection failed",
			"    at connect (/Users/bikash/code/maina/src/db/index.ts:42:10)",
			"    at main (/Users/bikash/code/maina/src/index.ts:15:5)",
		].join("\n");

		const result = scrubStackTrace(stack);
		expect(result).toContain("at connect");
		expect(result).toContain("at main");
		expect(result).not.toContain("/Users/bikash");
	});
});

// ── scrubPii (combined) ─────────────────────────────────────────────────

describe("scrubPii", () => {
	test("scrubs paths + secrets + emails in one pass", () => {
		const input =
			"Error at /Users/bikash/code/src/auth.ts: token sk-abc123def456ghi789jkl012mno345 for user@example.com";
		const result = scrubPii(input);
		expect(result).not.toContain("/Users/bikash");
		expect(result).not.toContain("user@example.com");
		expect(result).toContain("[REDACTED]");
		expect(result).toContain("[EMAIL]");
	});

	test("handles clean text without changes", () => {
		const input = "Error: timeout after 5000ms";
		expect(scrubPii(input)).toBe(input);
	});
});

// ── scrubErrorEvent ─────────────────────────────────────────────────────

describe("scrubErrorEvent", () => {
	test("scrubs all string fields in an event", () => {
		const event = {
			message: "Failed for user@example.com",
			stack: "Error\n    at fn (/Users/bikash/code/maina/src/index.ts:10:5)",
			level: "error",
			timestamp: 1234567890,
		};

		const result = scrubErrorEvent(event);
		expect(result.message).not.toContain("user@example.com");
		expect(result.stack).not.toContain("/Users/bikash");
		expect(result.level).toBe("error");
		expect(result.timestamp).toBe(1234567890);
	});
});
