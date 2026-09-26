import { describe, expect, test } from "bun:test";
import { CHECK_SUMMARY_LIMIT, conclusionFor, upsertCheckRun } from "../checks";
import { fakeGitHub, HEAD_SHA, REPO } from "./fixtures";

const auth = { token: "t0ken", readOnly: false } as const;
const check = {
	name: "maina/receipt",
	headSha: HEAD_SHA,
	conclusion: "success",
	title: "passed 3 of 3 checks",
	summary: "all good",
} as const;

describe("conclusionFor", () => {
	test("maps receipt status onto a check-run conclusion", () => {
		expect(conclusionFor("passed")).toBe("success");
		expect(conclusionFor("failed")).toBe("failure");
		expect(conclusionFor("partial")).toBe("neutral");
	});
});

describe("upsertCheckRun", () => {
	test("creates a completed check run on the head commit", async () => {
		const gh = fakeGitHub();
		const result = await upsertCheckRun({
			http: gh.http,
			auth,
			repo: REPO,
			check,
		});
		expect(result.ok && result.value.action).toBe("created");
		expect(gh.checks).toHaveLength(1);
		expect(gh.checks[0]).toMatchObject({
			name: "maina/receipt",
			head_sha: HEAD_SHA,
			status: "completed",
			conclusion: "success",
			output: { title: "passed 3 of 3 checks", summary: "all good" },
		});
	});

	test("repeated publishes update the same check run", async () => {
		const gh = fakeGitHub();
		const first = await upsertCheckRun({
			http: gh.http,
			auth,
			repo: REPO,
			check,
		});
		const second = await upsertCheckRun({
			http: gh.http,
			auth,
			repo: REPO,
			check: { ...check, conclusion: "failure", title: "flagged" },
		});
		expect(first.ok && second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(second.value.action).toBe("updated");
		expect(second.value.id).toBe(first.value.id);
		expect(gh.checks).toHaveLength(1);
		expect(gh.checks[0]?.conclusion).toBe("failure");
	});

	test("keeps the summary inside GitHub's output limit", async () => {
		const gh = fakeGitHub();
		await upsertCheckRun({
			http: gh.http,
			auth,
			repo: REPO,
			check: { ...check, summary: "x".repeat(CHECK_SUMMARY_LIMIT + 500) },
		});
		expect(gh.checks[0]?.output.summary.length).toBeLessThanOrEqual(
			CHECK_SUMMARY_LIMIT,
		);
	});

	test("a read-only token is a forbidden error", async () => {
		const gh = fakeGitHub();
		gh.setReadOnly(true);
		const result = await upsertCheckRun({
			http: gh.http,
			auth,
			repo: REPO,
			check,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("forbidden");
	});
});
