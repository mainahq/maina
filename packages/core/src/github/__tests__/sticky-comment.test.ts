import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildCommentBody, upsertStickyComment } from "../sticky-comment";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
	mockFetch = mock(() => Promise.resolve(new Response("", { status: 200 })));
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

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

describe("upsertStickyComment", () => {
	const baseOptions = {
		token: "test-tok",
		owner: "mainahq",
		repo: "maina",
		prNumber: 42,
		body: "<!-- maina:run -->\n## Maina verification\nPassed",
	};

	test("creates new comment when none exists", async () => {
		mockFetch
			.mockImplementationOnce(() => jsonResponse([])) // list: empty
			.mockImplementationOnce(() => jsonResponse({ id: 999 }, 201)) // create
			.mockImplementationOnce(() => jsonResponse([])); // dedup: empty

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.action).toBe("created");
			expect(result.value.commentId).toBe(999);
		}
	});

	test("updates existing comment when marker found", async () => {
		mockFetch
			.mockImplementationOnce(() =>
				jsonResponse([{ id: 555, body: "<!-- maina:run -->\nOld" }]),
			)
			.mockImplementationOnce(() => new Response("", { status: 200 })); // PATCH

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.action).toBe("updated");
			expect(result.value.commentId).toBe(555);
		}

		const calls = mockFetch.mock.calls;
		const updateCall = calls[1] as unknown[];
		const updateInit = updateCall[1] as RequestInit;
		expect(updateInit.method).toBe("PATCH");
	});

	test("returns error on 403 (missing permission)", async () => {
		mockFetch
			.mockImplementationOnce(() => jsonResponse([])) // list: empty
			.mockImplementationOnce(() => new Response("", { status: 403 })); // create: 403

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("issues:write");
		}
	});

	test("returns error on 404 (missing permission)", async () => {
		mockFetch
			.mockImplementationOnce(() => jsonResponse([])) // list: empty
			.mockImplementationOnce(() => new Response("", { status: 404 })); // create: 404

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

	test("returns error when list-comments API fails", async () => {
		mockFetch.mockImplementationOnce(
			() =>
				new Response("", {
					status: 500,
					statusText: "Internal Server Error",
				}),
		);

		const result = await upsertStickyComment(baseOptions);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Failed to list PR comments");
		}
	});

	test("prepends marker if body is missing it", async () => {
		mockFetch
			.mockImplementationOnce(() => jsonResponse([])) // list: empty
			.mockImplementationOnce(() => jsonResponse({ id: 100 }, 201)) // create
			.mockImplementationOnce(() => jsonResponse([])); // dedup

		const result = await upsertStickyComment({
			...baseOptions,
			body: "No marker here",
		});
		expect(result.ok).toBe(true);

		const calls = mockFetch.mock.calls;
		const createCall = calls[1] as unknown[];
		const createInit = createCall[1] as RequestInit;
		const sentBody = JSON.parse(createInit.body as string);
		expect(sentBody.body).toContain("<!-- maina:run -->");
	});
});
