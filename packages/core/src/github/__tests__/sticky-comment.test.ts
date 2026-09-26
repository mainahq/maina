import { describe, expect, test } from "bun:test";
import { upsertStickyComment } from "../sticky-comment";
import { fakeGitHub, REPO, writes } from "./fixtures";

const MARKER = "<!-- maina:test -->";
const auth = { token: "t0ken", readOnly: false } as const;
const target = { repo: REPO, number: 7 } as const;

describe("upsertStickyComment", () => {
	test("creates the comment when none carries the marker", async () => {
		const gh = fakeGitHub();
		gh.seedComment("an unrelated comment", "octocat");
		const result = await upsertStickyComment({
			http: gh.http,
			auth,
			pr: target,
			marker: MARKER,
			body: `${MARKER}\nfirst`,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.action).toBe("created");
		expect(gh.comments.filter((c) => c.body.includes(MARKER))).toHaveLength(1);
	});

	test("repeated publishes update in place under a single comment id", async () => {
		const gh = fakeGitHub();
		const ids: number[] = [];
		for (const body of ["one", "two", "three"]) {
			const result = await upsertStickyComment({
				http: gh.http,
				auth,
				pr: target,
				marker: MARKER,
				body: `${MARKER}\n${body}`,
			});
			if (!result.ok) throw new Error(JSON.stringify(result.error));
			ids.push(result.value.id);
		}
		expect(new Set(ids).size).toBe(1);
		expect(gh.comments).toHaveLength(1);
		expect(gh.comments[0]?.body).toBe(`${MARKER}\nthree`);
	});

	test("an unchanged body sends no write", async () => {
		const gh = fakeGitHub();
		const input = {
			http: gh.http,
			auth,
			pr: target,
			marker: MARKER,
			body: `${MARKER}\nsame`,
		};
		await upsertStickyComment(input);
		const before = writes(gh.requests).length;
		const again = await upsertStickyComment(input);
		expect(again.ok && again.value.action).toBe("unchanged");
		expect(writes(gh.requests).length).toBe(before);
	});

	test("finds the marker past the first page and folds duplicates into one", async () => {
		const gh = fakeGitHub({ pageSize: 2 });
		for (let i = 0; i < 5; i++) gh.seedComment(`chatter ${i}`, "octocat");
		const keep = gh.seedComment(`${MARKER}\nold`);
		gh.seedComment(`${MARKER}\nduplicate`);
		const result = await upsertStickyComment({
			http: gh.http,
			auth,
			pr: target,
			marker: MARKER,
			body: `${MARKER}\nnew`,
		});
		expect(result.ok && result.value.id).toBe(keep);
		expect(gh.comments.filter((c) => c.body.includes(MARKER))).toEqual([
			{
				id: keep,
				body: `${MARKER}\nnew`,
				user: { login: "github-actions[bot]" },
			},
		]);
	});

	test("ignores a marker comment written by someone other than the bot", async () => {
		const gh = fakeGitHub();
		gh.seedComment(`${MARKER}\nspoofed`, "mallory");
		const result = await upsertStickyComment({
			http: gh.http,
			auth,
			pr: target,
			marker: MARKER,
			body: `${MARKER}\nreal`,
			author: "github-actions[bot]",
		});
		expect(result.ok && result.value.action).toBe("created");
		expect(gh.comments.find((c) => c.user.login === "mallory")?.body).toBe(
			`${MARKER}\nspoofed`,
		);
	});

	test("a comment that only quotes the marker is not the sticky one", async () => {
		const gh = fakeGitHub();
		const quoted = gh.seedComment(`why does the bot post ${MARKER}?`);
		const result = await upsertStickyComment({
			http: gh.http,
			auth,
			pr: target,
			marker: MARKER,
			body: `${MARKER}\nreal`,
		});
		expect(result.ok && result.value.action).toBe("created");
		expect(gh.comments.find((c) => c.id === quoted)?.body).toBe(
			`why does the bot post ${MARKER}?`,
		);
	});

	test("a read-only token comes back as a forbidden error, never a throw", async () => {
		const gh = fakeGitHub();
		gh.setReadOnly(true);
		const result = await upsertStickyComment({
			http: gh.http,
			auth,
			pr: target,
			marker: MARKER,
			body: `${MARKER}\nx`,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("forbidden");
	});

	test("sends the token and the GitHub API headers", async () => {
		const gh = fakeGitHub();
		await upsertStickyComment({
			http: gh.http,
			auth: { ...auth, apiUrl: "https://ghe.example.com/api/v3" },
			pr: target,
			marker: MARKER,
			body: `${MARKER}\nx`,
		});
		const first = gh.requests[0];
		expect(first?.url.startsWith("https://ghe.example.com/api/v3/repos/")).toBe(
			true,
		);
		expect(first?.headers.authorization).toBe("Bearer t0ken");
		expect(first?.headers.accept).toBe("application/vnd.github+json");
	});
});
