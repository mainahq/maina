import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	type DelegationRequest,
	formatDelegationRequest,
	outputDelegationRequest,
	parseDelegationRequest,
} from "../delegation";

describe("formatDelegationRequest", () => {
	it("should format a request with all fields", () => {
		const req: DelegationRequest = {
			task: "ai-review",
			context: "Reviewing diff for cross-function consistency",
			prompt: "Review this diff:\n+const x = 1;",
			expectedFormat: "json",
			schema: '{"findings":[]}',
		};

		const formatted = formatDelegationRequest(req);

		expect(formatted).toContain("---MAINA_AI_REQUEST---");
		expect(formatted).toContain("---END_MAINA_AI_REQUEST---");
		expect(formatted).toContain("task: ai-review");
		expect(formatted).toContain("context: Reviewing diff");
		expect(formatted).toContain("expected_format: json");
		expect(formatted).toContain("schema: ");
		expect(formatted).toContain("prompt: |");
		expect(formatted).toContain("  Review this diff:");
	});

	it("should format without optional schema", () => {
		const req: DelegationRequest = {
			task: "commit-msg",
			context: "Generate commit message",
			prompt: "Generate a commit message for these changes",
			expectedFormat: "text",
		};

		const formatted = formatDelegationRequest(req);
		expect(formatted).not.toContain("schema:");
	});
});

describe("parseDelegationRequest", () => {
	it("should parse a formatted request back", () => {
		const original: DelegationRequest = {
			task: "ai-review",
			context: "Reviewing diff",
			prompt: "Review this diff:\n+const x = 1;",
			expectedFormat: "json",
			schema: '{"findings":[]}',
		};

		const formatted = formatDelegationRequest(original);
		const parsed = parseDelegationRequest(formatted);

		expect(parsed).not.toBeNull();
		expect(parsed?.task).toBe("ai-review");
		expect(parsed?.context).toBe("Reviewing diff");
		expect(parsed?.expectedFormat).toBe("json");
		expect(parsed?.schema).toBe('{"findings":[]}');
		expect(parsed?.prompt).toContain("Review this diff:");
		expect(parsed?.prompt).toContain("+const x = 1;");
	});

	it("should return null for text without markers", () => {
		expect(parseDelegationRequest("no markers here")).toBeNull();
	});

	it("should return null for empty task", () => {
		const text =
			"---MAINA_AI_REQUEST---\ncontext: test\n---END_MAINA_AI_REQUEST---";
		expect(parseDelegationRequest(text)).toBeNull();
	});

	it("should handle multiline prompts", () => {
		const req: DelegationRequest = {
			task: "review",
			context: "Code review",
			prompt: "Line 1\nLine 2\nLine 3",
			expectedFormat: "markdown",
		};

		const formatted = formatDelegationRequest(req);
		const parsed = parseDelegationRequest(formatted);

		expect(parsed?.prompt).toContain("Line 1");
		expect(parsed?.prompt).toContain("Line 2");
		expect(parsed?.prompt).toContain("Line 3");
	});

	it("should parse request embedded in other text", () => {
		const text = `Some output before
---MAINA_AI_REQUEST---
task: test
context: testing
prompt: |
  hello
---END_MAINA_AI_REQUEST---
Some output after`;

		const parsed = parseDelegationRequest(text);
		expect(parsed?.task).toBe("test");
		expect(parsed?.prompt).toBe("hello");
	});
});

describe("outputDelegationRequest", () => {
	let stderrChunks: string[];
	let stdoutChunks: string[];
	let originalStderrWrite: typeof process.stderr.write;
	let originalStdoutWrite: typeof process.stdout.write;

	beforeEach(() => {
		stderrChunks = [];
		stdoutChunks = [];
		originalStderrWrite = process.stderr.write;
		originalStdoutWrite = process.stdout.write;

		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderrChunks.push(
				typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
			);
			return true;
		}) as typeof process.stderr.write;

		process.stdout.write = ((chunk: string | Uint8Array) => {
			stdoutChunks.push(
				typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
			);
			return true;
		}) as typeof process.stdout.write;
	});

	afterEach(() => {
		process.stderr.write = originalStderrWrite;
		process.stdout.write = originalStdoutWrite;
	});

	it("writes to stderr, not stdout (prevents MCP protocol corruption)", () => {
		const req: DelegationRequest = {
			task: "review",
			context: "test context",
			prompt: "test prompt",
			expectedFormat: "text",
		};

		outputDelegationRequest(req);

		// Must write to stderr
		expect(stderrChunks.length).toBeGreaterThan(0);
		const stderrOutput = stderrChunks.join("");
		expect(stderrOutput).toContain("---MAINA_AI_REQUEST---");
		expect(stderrOutput).toContain("task: review");

		// Must NOT write to stdout (stdout is reserved for JSON-RPC in MCP)
		expect(stdoutChunks.length).toBe(0);
	});
});
