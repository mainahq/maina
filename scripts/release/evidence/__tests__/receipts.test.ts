/**
 * The receipted-merges evidence (spec §9.5): every PR merged into v1/main,
 * checked the way the Dogfood receipt check does (a trusted receipt comment
 * for the merged head, status passed).
 */

import { describe, expect, test } from "bun:test";
import {
	type DogfoodReceipt,
	formatReceiptComment,
} from "../../../dogfood/receipt-check";
import { receiptedMergesEvidence } from "../receipts";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";
const sha = (c: string) => c.repeat(40);

const receipt = (
	commit: string,
	status: DogfoodReceipt["status"] = "passed",
): string =>
	formatReceiptComment({
		kind: "maina-dogfood-receipt",
		version: 1,
		commit,
		base: sha("0"),
		status,
		receiptHash: null,
		checks: { passed: 3, total: 3 },
		ts: "2026-09-26T10:00:00.000Z",
	});

const comment = (body: string, authorAssociation = "OWNER") => ({
	body,
	authorAssociation,
	createdAt: "2026-09-26T10:00:00Z",
});

describe("receiptedMergesEvidence", () => {
	test("a merge counts only with a passed receipt for its merged head", () => {
		const prs = [
			{
				number: 1,
				headRefOid: sha("a"),
				comments: [comment(receipt(sha("a")))],
			},
			// Receipt for an earlier head: stale.
			{
				number: 2,
				headRefOid: sha("b"),
				comments: [comment(receipt(sha("c")))],
			},
			{ number: 3, headRefOid: sha("d"), comments: [] },
			{
				number: 4,
				headRefOid: sha("e"),
				comments: [comment(receipt(sha("e"), "failed"))],
			},
			// Anyone can post text: an untrusted author's receipt does not count.
			{
				number: 5,
				headRefOid: sha("f"),
				comments: [comment(receipt(sha("f")), "NONE")],
			},
		];
		expect(receiptedMergesEvidence(prs, LINK)).toEqual({
			link: LINK,
			merges: 5,
			receipted: 1,
			unreceipted: [
				"#2 (stale)",
				"#3 (missing)",
				"#4 (failing)",
				"#5 (missing)",
			],
		});
	});

	test("unreceipted merges are listed in PR order", () => {
		const prs = [
			{ number: 9, headRefOid: sha("a"), comments: [] },
			{ number: 7, headRefOid: sha("b"), comments: [] },
		];
		expect(receiptedMergesEvidence(prs, LINK).unreceipted).toEqual([
			"#7 (missing)",
			"#9 (missing)",
		]);
	});
});
