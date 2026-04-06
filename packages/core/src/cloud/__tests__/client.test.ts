import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { type CloudClient, createCloudClient } from "../client";
import type { CloudConfig } from "../types";

// ── Helpers ─────────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

let mockFetch: ReturnType<typeof mock>;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function setupClient(overrides?: Partial<CloudConfig>): CloudClient {
	return createCloudClient({
		baseUrl: "https://api.test.maina.dev",
		token: "test-token-abc",
		timeoutMs: 5_000,
		maxRetries: 2,
		...overrides,
	});
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
	mockFetch = mock(() =>
		Promise.resolve(jsonResponse({ data: { status: "ok" } })),
	);
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createCloudClient", () => {
	test("health returns ok status", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: { status: "ok" } })),
		);

		const client = setupClient();
		const result = await client.health();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("ok");
		}
	});

	test("attaches Authorization header when token is provided", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: { status: "ok" } })),
		);

		const client = setupClient({ token: "my-secret-token" });
		await client.health();

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const call = mockFetch.mock.calls[0] as unknown[];
		const requestInit = call[1] as RequestInit;
		const authHeader = (requestInit.headers as Record<string, string>)
			.Authorization;
		expect(authHeader).toBe("Bearer my-secret-token");
	});

	test("omits Authorization header when no token", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: { status: "ok" } })),
		);

		const client = setupClient({ token: undefined });
		await client.health();

		const call = mockFetch.mock.calls[0] as unknown[];
		const requestInit = call[1] as RequestInit;
		const h = requestInit.headers as Record<string, string>;
		expect(h.Authorization).toBeUndefined();
	});

	test("retries on 500 errors", async () => {
		let attempts = 0;
		mockFetch.mockImplementation(() => {
			attempts++;
			if (attempts < 3) {
				return Promise.resolve(jsonResponse({ error: "Internal error" }, 500));
			}
			return Promise.resolve(jsonResponse({ data: { status: "ok" } }));
		});

		const client = setupClient({ maxRetries: 2 });
		const result = await client.health();

		expect(result.ok).toBe(true);
		expect(attempts).toBe(3);
	});

	test("retries on 429 rate limit", async () => {
		let attempts = 0;
		mockFetch.mockImplementation(() => {
			attempts++;
			if (attempts === 1) {
				return Promise.resolve(
					jsonResponse({ error: "Too many requests" }, 429),
				);
			}
			return Promise.resolve(jsonResponse({ data: { status: "ok" } }));
		});

		const client = setupClient({ maxRetries: 2 });
		const result = await client.health();

		expect(result.ok).toBe(true);
		expect(attempts).toBe(2);
	});

	test("returns error after exhausting retries", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "Server down" }, 503)),
		);

		const client = setupClient({ maxRetries: 1 });
		const result = await client.health();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Server down");
		}
	});

	test("returns error on non-retryable 4xx", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "Forbidden" }, 403)),
		);

		const client = setupClient();
		const result = await client.health();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("Forbidden");
		}
	});

	test("getPrompts returns prompt records", async () => {
		const prompts = [
			{
				id: "p1",
				path: "commit.md",
				content: "# Commit",
				hash: "abc",
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: prompts })),
		);

		const client = setupClient();
		const result = await client.getPrompts();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0]?.path).toBe("commit.md");
		}
	});

	test("putPrompts sends prompts array", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(new Response(null, { status: 204 })),
		);

		const client = setupClient();
		const result = await client.putPrompts([
			{
				id: "p1",
				path: "commit.md",
				content: "# Commit",
				hash: "abc",
				updatedAt: "2026-01-01T00:00:00Z",
			},
		]);

		expect(result.ok).toBe(true);

		const call = mockFetch.mock.calls[0] as unknown[];
		const requestInit = call[1] as RequestInit;
		expect(requestInit.method).toBe("PUT");
		const body = JSON.parse(requestInit.body as string);
		expect(body.prompts).toHaveLength(1);
	});

	test("inviteTeamMember sends email and role", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: { invited: true } })),
		);

		const client = setupClient();
		const result = await client.inviteTeamMember("new@example.com", "admin");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.invited).toBe(true);
		}

		const call = mockFetch.mock.calls[0] as unknown[];
		const requestInit = call[1] as RequestInit;
		const body = JSON.parse(requestInit.body as string);
		expect(body.email).toBe("new@example.com");
		expect(body.role).toBe("admin");
	});

	test("postFeedback sends payload", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: { recorded: true } })),
		);

		const client = setupClient();
		const result = await client.postFeedback({
			promptHash: "hash-123",
			command: "commit",
			accepted: true,
			timestamp: "2026-01-01T00:00:00Z",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.recorded).toBe(true);
		}
	});

	test("handles network errors gracefully", async () => {
		mockFetch.mockImplementation(() =>
			Promise.reject(new Error("Network unreachable")),
		);

		const client = setupClient({ maxRetries: 0 });
		const result = await client.health();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Network unreachable");
		}
	});

	// ── submitVerify ─────────────────────────────────────────────────────────

	test("submitVerify sends diff, repo, and base_branch", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: { jobId: "job-abc-123" } })),
		);

		const client = setupClient();
		const result = await client.submitVerify({
			diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new",
			repo: "acme/app",
			baseBranch: "main",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.jobId).toBe("job-abc-123");
		}

		const call = mockFetch.mock.calls[0] as unknown[];
		const url = call[0] as string;
		const requestInit = call[1] as RequestInit;
		expect(url).toBe("https://api.test.maina.dev/verify");
		expect(requestInit.method).toBe("POST");
		const body = JSON.parse(requestInit.body as string);
		expect(body.diff).toContain("+new");
		expect(body.repo).toBe("acme/app");
		expect(body.base_branch).toBe("main");
	});

	test("submitVerify omits base_branch when not provided", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: { jobId: "job-def-456" } })),
		);

		const client = setupClient();
		await client.submitVerify({
			diff: "some diff",
			repo: "acme/app",
		});

		const call = mockFetch.mock.calls[0] as unknown[];
		const requestInit = call[1] as RequestInit;
		const body = JSON.parse(requestInit.body as string);
		expect(body.base_branch).toBeUndefined();
	});

	test("submitVerify returns error on 401", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "Unauthorized" }, 401)),
		);

		const client = setupClient();
		const result = await client.submitVerify({
			diff: "diff",
			repo: "acme/app",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("Unauthorized");
		}
	});

	// ── getVerifyStatus ──────────────────────────────────────────────────────

	test("getVerifyStatus returns queued status", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(
				jsonResponse({
					data: { status: "queued", currentStep: "Waiting in queue" },
				}),
			),
		);

		const client = setupClient();
		const result = await client.getVerifyStatus("job-abc-123");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("queued");
			expect(result.value.currentStep).toBe("Waiting in queue");
		}

		const call = mockFetch.mock.calls[0] as unknown[];
		const url = call[0] as string;
		expect(url).toBe("https://api.test.maina.dev/verify/job-abc-123/status");
	});

	test("getVerifyStatus returns running status", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(
				jsonResponse({
					data: {
						status: "running",
						currentStep: "Running Biome lint",
					},
				}),
			),
		);

		const client = setupClient();
		const result = await client.getVerifyStatus("job-abc-123");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("running");
			expect(result.value.currentStep).toBe("Running Biome lint");
		}
	});

	test("getVerifyStatus returns error on 404", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "Job not found" }, 404)),
		);

		const client = setupClient();
		const result = await client.getVerifyStatus("nonexistent");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("Job not found");
		}
	});

	test("getVerifyStatus retries on 500", async () => {
		let attempts = 0;
		mockFetch.mockImplementation(() => {
			attempts++;
			if (attempts === 1) {
				return Promise.resolve(jsonResponse({ error: "Internal error" }, 500));
			}
			return Promise.resolve(
				jsonResponse({
					data: { status: "done", currentStep: "Complete" },
				}),
			);
		});

		const client = setupClient({ maxRetries: 2 });
		const result = await client.getVerifyStatus("job-abc-123");

		expect(result.ok).toBe(true);
		expect(attempts).toBe(2);
	});

	// ── getVerifyResult ──────────────────────────────────────────────────────

	test("getVerifyResult returns passing result", async () => {
		const verifyResult = {
			id: "job-abc-123",
			status: "done",
			passed: true,
			findings: [],
			findingsErrors: 0,
			findingsWarnings: 0,
			proofKey: "proof-xyz-789",
			durationMs: 4523,
		};
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: verifyResult })),
		);

		const client = setupClient();
		const result = await client.getVerifyResult("job-abc-123");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.id).toBe("job-abc-123");
			expect(result.value.passed).toBe(true);
			expect(result.value.findings).toHaveLength(0);
			expect(result.value.proofKey).toBe("proof-xyz-789");
			expect(result.value.durationMs).toBe(4523);
		}

		const call = mockFetch.mock.calls[0] as unknown[];
		const url = call[0] as string;
		expect(url).toBe("https://api.test.maina.dev/verify/job-abc-123");
	});

	test("getVerifyResult returns failing result with findings", async () => {
		const verifyResult = {
			id: "job-fail-456",
			status: "failed",
			passed: false,
			findings: [
				{
					tool: "biome",
					file: "src/index.ts",
					line: 42,
					message: "Unexpected console.log",
					severity: "error",
					ruleId: "no-console",
				},
				{
					tool: "semgrep",
					file: "src/utils.ts",
					line: 10,
					message: "Potential SQL injection",
					severity: "warning",
				},
			],
			findingsErrors: 1,
			findingsWarnings: 1,
			proofKey: null,
			durationMs: 3200,
		};
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: verifyResult })),
		);

		const client = setupClient();
		const result = await client.getVerifyResult("job-fail-456");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.passed).toBe(false);
			expect(result.value.findings).toHaveLength(2);
			expect(result.value.findings[0]?.tool).toBe("biome");
			expect(result.value.findings[0]?.severity).toBe("error");
			expect(result.value.findings[0]?.ruleId).toBe("no-console");
			expect(result.value.findings[1]?.tool).toBe("semgrep");
			expect(result.value.findings[1]?.ruleId).toBeUndefined();
			expect(result.value.findingsErrors).toBe(1);
			expect(result.value.findingsWarnings).toBe(1);
			expect(result.value.proofKey).toBeNull();
		}
	});

	test("getVerifyResult returns error on 404", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "Job not found" }, 404)),
		);

		const client = setupClient();
		const result = await client.getVerifyResult("nonexistent");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("Job not found");
		}
	});
});
