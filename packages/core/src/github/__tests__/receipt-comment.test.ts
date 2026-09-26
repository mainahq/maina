import { describe, expect, test } from "bun:test";
import {
	RECEIPT_COMMENT_MARKER,
	renderReceiptComment,
} from "../receipt-comment";
import { sampleCommentReceipt, sampleReceipt } from "./fixtures";

describe("renderReceiptComment", () => {
	test("starts with the sticky marker so the comment can be found again", () => {
		const md = renderReceiptComment(sampleCommentReceipt(), {
			discoveryLine: false,
		});
		expect(md.startsWith(RECEIPT_COMMENT_MARKER)).toBe(true);
	});

	test("shows each acceptance criterion with its evidence", () => {
		const md = renderReceiptComment(sampleCommentReceipt(), {
			discoveryLine: false,
		});
		expect(md).toContain("AC-1");
		expect(md).toContain("Uploads retry up to 3 times on a 5xx");
		expect(md).toContain("tests: uploader.test.ts:42");
		expect(md).toContain("check biome passed");
		expect(md).toContain("AC-2");
		expect(md).toContain("A 4xx is not retried");
		// A criterion without evidence says so rather than leaving a blank cell.
		expect(md).toMatch(/AC-2[^\n]*awaiting evidence/);
	});

	test("shows the verify scope and result in affirmative framing", () => {
		const md = renderReceiptComment(sampleCommentReceipt(), {
			discoveryLine: false,
		});
		expect(md).toContain("passed 2 of 3 checks");
		expect(md).toContain("`origin/main`");
		expect(md).toContain("4 files");
		expect(md).toContain("+120");
		expect(md).toContain("−8");
		expect(md).not.toMatch(/\b(0 findings?|no issues? found|no errors?)\b/i);
	});

	test("shows the triage decision and its confidence", () => {
		const md = renderReceiptComment(sampleCommentReceipt(), {
			discoveryLine: false,
		});
		expect(md).toContain("deep review");
		expect(md).toContain("87%");

		const light = renderReceiptComment(
			sampleCommentReceipt({
				triage: { decisionId: "x", needsReview: false, confidence: 0.93 },
			}),
			{ discoveryLine: false },
		);
		expect(light).toContain("fast path");
		expect(light).toContain("93%");
	});

	test("shows the gate counts and each override", () => {
		const md = renderReceiptComment(sampleCommentReceipt(), {
			discoveryLine: false,
		});
		expect(md).toContain("1 blocked");
		expect(md).toContain("2 asked");
		expect(md).toContain("14 allowed");
		expect(md).toContain("1 override");
		expect(md).toContain("git push --force-with-lease");
		expect(md).toContain("action.risk:77");
	});

	test("links the full receipt and names its hash", () => {
		const md = renderReceiptComment(sampleCommentReceipt(), {
			discoveryLine: false,
		});
		expect(md).toContain(
			"[Full receipt](https://github.com/acme/widgets/actions/runs/99)",
		);
		expect(md).toContain("b".repeat(12));
	});

	test("never links a non-http receipt url", () => {
		const md = renderReceiptComment(
			sampleCommentReceipt({ url: "javascript:alert(1)" }),
			{ discoveryLine: false },
		);
		expect(md).not.toContain("javascript:");
		expect(md).not.toContain("[Full receipt]");
	});

	test("the discovery line is opt-in per render", () => {
		const receipt = sampleCommentReceipt();
		const on = renderReceiptComment(receipt, { discoveryLine: true });
		const off = renderReceiptComment(receipt, { discoveryLine: false });
		expect(on).toContain("mainahq.com");
		expect(off).not.toContain("mainahq.com");
	});

	test("renders a plain v1 receipt without the optional sections", () => {
		const md = renderReceiptComment(sampleReceipt({ triage: undefined }), {
			discoveryLine: false,
		});
		expect(md).toContain("passed 2 of 3 checks");
		expect(md).toContain("triage did not run");
		expect(md).not.toContain("Acceptance criteria");
		expect(md).not.toContain("[Full receipt]");
	});

	test("is deterministic", () => {
		const receipt = sampleCommentReceipt();
		expect(renderReceiptComment(receipt, { discoveryLine: true })).toBe(
			renderReceiptComment(receipt, { discoveryLine: true }),
		);
	});

	test("escapes user text so it cannot break the table, inject HTML or ping people", () => {
		const md = renderReceiptComment(
			sampleCommentReceipt({
				criteria: [
					{
						id: "AC|1",
						text: "a | b <img src=x> @octocat\nnext",
						status: "met",
						evidence: ["<script>"],
					},
				],
			}),
			{ discoveryLine: false },
		);
		expect(md).not.toContain("<img");
		expect(md).not.toContain("<script>");
		expect(md).toContain("a \\| b");
		expect(md).not.toMatch(/(^|[^\w])@octocat/);
		expect(md).not.toContain("<!-- maina:receipt v2 -->\n".repeat(2));
	});

	test("names flagged checks with their finding counts", () => {
		const md = renderReceiptComment(
			sampleCommentReceipt({
				status: "failed",
				checks: [
					{
						id: "semgrep",
						name: "Semgrep",
						status: "failed",
						tool: "semgrep",
						findings: [
							{ severity: "error", file: "a.ts", line: 3, message: "eval" },
							{ severity: "warning", file: "b.ts", message: "risky" },
						],
					},
					{
						id: "tests",
						name: "Tests",
						status: "passed",
						tool: "tests",
						findings: [],
					},
				],
			}),
			{ discoveryLine: false },
		);
		expect(md).toContain("failed");
		expect(md).toContain("1 of 2 checks held");
		expect(md).toMatch(/Semgrep[^\n]*flagged[^\n]*2/);
	});
});
