/**
 * Tests for the receipt-required merge check (#286, FR-DOG-5).
 *
 * `receiptCheck(prHead, receipt)` passes only when the receipt's commit is
 * the PR head and its status is `passed`. Receipts travel as PR comments,
 * so the comment format round-trips and only trusted authors count.
 */

import { describe, expect, test } from "bun:test";
import {
	type DogfoodReceipt,
	formatReceiptComment,
	type PrComment,
	parseReceiptComment,
	receiptCheck,
	selectReceipt,
} from "../receipt-check";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

const receipt = (over: Partial<DogfoodReceipt> = {}): DogfoodReceipt => ({
	kind: "maina-dogfood-receipt",
	version: 1,
	commit: HEAD,
	base: "c".repeat(40),
	status: "passed",
	receiptHash: "d".repeat(64),
	checks: { passed: 5, total: 5 },
	ts: "2026-09-25T10:00:00.000Z",
	...over,
});

const comment = (body: string, over: Partial<PrComment> = {}): PrComment => ({
	body,
	authorAssociation: "MEMBER",
	createdAt: "2026-09-25T10:00:00Z",
	...over,
});

describe("receiptCheck", () => {
	test("passes for a passed receipt on the head commit", () => {
		const r = receiptCheck(HEAD, receipt());
		expect(r.ok).toBe(true);
	});

	test("rejects a missing receipt", () => {
		const r = receiptCheck(HEAD, undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("missing");
	});

	test("rejects a stale receipt (commit is not the head)", () => {
		const r = receiptCheck(HEAD, receipt({ commit: OLD }));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("stale");
	});

	test("rejects a failing receipt", () => {
		for (const status of ["failed", "partial"] as const) {
			const r = receiptCheck(HEAD, receipt({ status }));
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe("failing");
		}
	});

	test("rejects a malformed receipt", () => {
		for (const bad of [
			{},
			{ ...receipt(), commit: "not-a-sha" },
			{ ...receipt(), kind: "other" },
			"string",
			null,
		]) {
			const r = receiptCheck(HEAD, bad);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe("invalid");
		}
	});

	test("head comparison is case-insensitive but exact", () => {
		expect(receiptCheck(HEAD.toUpperCase(), receipt()).ok).toBe(true);
		expect(receiptCheck(HEAD.slice(0, 12), receipt()).ok).toBe(false);
	});
});

describe("comment format", () => {
	test("round-trips a receipt through a PR comment", () => {
		const body = formatReceiptComment(receipt());
		expect(body).toContain("<!-- maina-dogfood-receipt -->");
		expect(parseReceiptComment(body)).toEqual(receipt());
	});

	test("ignores comments without the marker", () => {
		expect(parseReceiptComment("LGTM")).toBeUndefined();
	});

	test("unparseable JSON yields undefined", () => {
		expect(
			parseReceiptComment(
				"<!-- maina-dogfood-receipt -->\n```json\n{oops\n```",
			),
		).toBeUndefined();
	});
});

describe("selectReceipt", () => {
	test("prefers the newest trusted receipt for the head", () => {
		const failedHead = receipt({ status: "failed" });
		const passedHead = receipt();
		const picked = selectReceipt(
			[
				comment(formatReceiptComment(failedHead), {
					createdAt: "2026-09-25T09:00:00Z",
				}),
				comment(formatReceiptComment(passedHead), {
					createdAt: "2026-09-25T11:00:00Z",
				}),
				comment(formatReceiptComment(receipt({ commit: OLD })), {
					createdAt: "2026-09-25T12:00:00Z",
				}),
			],
			HEAD,
		);
		expect(picked).toEqual(passedHead);
	});

	test("falls back to the newest receipt so staleness is reported", () => {
		const picked = selectReceipt(
			[comment(formatReceiptComment(receipt({ commit: OLD })))],
			HEAD,
		);
		expect(receiptCheck(HEAD, picked).ok).toBe(false);
		const r = receiptCheck(HEAD, picked);
		if (!r.ok) expect(r.error.code).toBe("stale");
	});

	test("ignores receipts from untrusted authors", () => {
		const picked = selectReceipt(
			[
				comment(formatReceiptComment(receipt()), {
					authorAssociation: "NONE",
				}),
				comment(formatReceiptComment(receipt()), {
					authorAssociation: "CONTRIBUTOR",
				}),
			],
			HEAD,
		);
		expect(picked).toBeUndefined();
	});

	test("no comments → undefined → missing", () => {
		const picked = selectReceipt([], HEAD);
		const r = receiptCheck(HEAD, picked);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("missing");
	});
});
