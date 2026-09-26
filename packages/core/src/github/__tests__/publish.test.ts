import { describe, expect, test } from "bun:test";
import { publishReceipt } from "../publish";
import { RECEIPT_COMMENT_MARKER } from "../receipt-comment";
import {
	fakeGitHub,
	HEAD_SHA,
	REPO,
	sampleCommentReceipt,
	writes,
} from "./fixtures";

const pr = { repo: REPO, number: 7, headSha: HEAD_SHA } as const;
const auth = { token: "t0ken", readOnly: false } as const;

describe("publishReceipt", () => {
	test("nothing posts without repo opt-in", async () => {
		const gh = fakeGitHub();
		const result = await publishReceipt({
			pr,
			receipt: sampleCommentReceipt(),
			auth,
			http: gh.http,
			optIn: false,
		});
		expect(result).toEqual({
			ok: true,
			value: { kind: "skipped", reason: "not_opted_in" },
		});
		expect(gh.requests).toHaveLength(0);
	});

	test("upserts exactly one comment and one check run across repeated publishes", async () => {
		const gh = fakeGitHub();
		const input = {
			pr,
			auth,
			http: gh.http,
			optIn: true,
			discoveryLine: true,
		};
		const first = await publishReceipt({
			...input,
			receipt: sampleCommentReceipt(),
		});
		const second = await publishReceipt({
			...input,
			receipt: sampleCommentReceipt({ status: "failed" }),
		});
		expect(first.ok && second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		if (first.value.kind !== "published" || second.value.kind !== "published") {
			throw new Error("expected published outcomes");
		}
		expect(second.value.commentId).toBe(first.value.commentId);
		expect(second.value.checkRunId).toBe(first.value.checkRunId);
		expect(gh.comments).toHaveLength(1);
		expect(gh.checks).toHaveLength(1);
		expect(gh.comments[0]?.body.startsWith(RECEIPT_COMMENT_MARKER)).toBe(true);
		expect(gh.comments[0]?.body).toContain("mainahq.com");
		expect(gh.checks[0]).toMatchObject({
			name: "maina/receipt",
			head_sha: HEAD_SHA,
			conclusion: "failure",
			details_url: "https://github.com/acme/widgets/actions/runs/99",
		});
	});

	test("a fork PR with a read-only token falls back to the job's check run", async () => {
		const gh = fakeGitHub();
		gh.setReadOnly(true);
		const result = await publishReceipt({
			pr,
			receipt: sampleCommentReceipt(),
			auth: { token: "t0ken", readOnly: true },
			http: gh.http,
			optIn: true,
		});
		expect(result.ok).toBe(true);
		if (!result.ok || result.value.kind !== "fallback") {
			throw new Error(`expected fallback, got ${JSON.stringify(result)}`);
		}
		expect(result.value.reason).toBe("read_only_token");
		expect(result.value.markdown).toContain("passed 2 of 3 checks");
		// Known read-only: no write is even attempted.
		expect(writes(gh.requests)).toHaveLength(0);
	});

	test("a write refused mid-publish also falls back instead of failing", async () => {
		const gh = fakeGitHub();
		gh.setReadOnly(true);
		const result = await publishReceipt({
			pr,
			receipt: sampleCommentReceipt(),
			auth,
			http: gh.http,
			optIn: true,
		});
		expect(result.ok && result.value.kind).toBe("fallback");
		if (!result.ok || result.value.kind !== "fallback") return;
		expect(result.value.reason).toBe("forbidden");
	});

	test("rejects a malformed PR target before any request", async () => {
		const gh = fakeGitHub();
		const result = await publishReceipt({
			pr: { repo: "not a repo", number: 0, headSha: "zzz" },
			receipt: sampleCommentReceipt(),
			auth,
			http: gh.http,
			optIn: true,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_input");
		expect(gh.requests).toHaveLength(0);
	});

	test("an API outage is a Result error, not a throw", async () => {
		const result = await publishReceipt({
			pr,
			receipt: sampleCommentReceipt(),
			auth,
			http: {
				request: async (req) => ({
					ok: false,
					error: { kind: "network", url: req.url, message: "ECONNRESET" },
				}),
			},
			optIn: true,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("network");
	});
});
