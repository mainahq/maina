import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildCommentBody, upsertStickyComment } from "../sticky-comment";

// ── Mock fetch ──────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
	mockFetch = mock(() => Promise.resolve(new Response("", { status: 200 })));
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ── buildCommentBody ────────────────────────────────────────────────────

describe("buildCommentBody", () => {
	test("includes marker", () => {
		const body = buildCommentBody("Hello");
		expect(body).toContain("<!-- maina:run -->");
		expect(body).toContain("Hello");
	});

	test("includes run ID when provided", () => {
		const body = buildCommentBody("Hello", "abc123");
		expect(body).toContain("<!-- maina:run id=abc123 -->");
	});
});

// ── upsertStickyComment ─────────────────────────────────────────────────

describe("upsertStickyComment", () => {
	const baseOptions = {
		token: "test-token",
		owner: "mainahq",
		repo: "maina",
		prNumber: 42,
		body: "<!-- maina:run -->\n## Maina verification\nPassed",
	};

	test("creates new comment when none exists", async () => {
		// First call: list comments (empty)
		// Second call: create comment
		mockFetch
			.mockImplementationOnce(() =>
				Promise.resolve(
					new Response(JSON.stringify([]), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				),
			)
			.mockImplementationOnce(() =>
				Promise.resolve(
					new Response(JSON.stringify({ id: 999 }), {
						status: 201,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.action).toBe("created");
			expect(result.value.commentId).toBe(999);
		}
	});

	test("updates existing comment when marker found", async () => {
		// List comments returns one with marker
		mockFetch
			.mockImplementationOnce(() =>
				Promise.resolve(
					new Response(
						JSON.stringify([
							{ id: 555, body: "<!-- maina:run -->\nOld content" },
						]),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					),
				),
			)
			.mockImplementationOnce(() =>
				Promise.resolve(new Response("", { status: 200 })),
			);

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.action).toBe("updated");
			expect(result.value.commentId).toBe(555);
		}

		// Verify PATCH was called (not POST)
		const calls = mockFetch.mock.calls;
		expect(calls.length).toBe(2);
		const updateCall = calls[1] as unknown[];
		const updateInit = updateCall[1] as RequestInit;
		expect(updateInit.method).toBe("PATCH");
	});

	test("returns error on 403 (missing permission)", async () => {
		mockFetch
			.mockImplementationOnce(() =>
				Promise.resolve(
					new Response(JSON.stringify([]), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				),
			)
			.mockImplementationOnce(() =>
				Promise.resolve(new Response("", { status: 403 })),
			);

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("issues:write");
		}
	});

	test("returns error on network failure", async () => {
		mockFetch.mockImplementationOnce(() =>
			Promise.reject(new Error("Network unreachable")),
		);

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Network unreachable");
		}
	});
});
