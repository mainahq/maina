/**
 * The receipted-merges evidence (spec §9.5): every PR merged into v1/main
 * since receipt enforcement, checked the way the Dogfood receipt check does
 * (a trusted receipt comment for the merged head, status passed).
 */

import { describe, expect, test } from "bun:test";
import {
	type DogfoodReceipt,
	formatReceiptComment,
} from "../../../dogfood/receipt-check";
import {
	RECEIPTS_ENFORCED_BY,
	RECEIPTS_GRANDFATHERED,
	receiptedMergesEvidence,
} from "../receipts";

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

/** A merged PR; opened and merged after receipt enforcement by default. */
const merged = (
	number: number,
	headRefOid: string,
	comments: ReturnType<typeof comment>[] = [],
	createdAt = "2026-09-26T09:00:00Z",
	mergedAt = "2026-09-26T11:00:00Z",
) => ({ number, headRefOid, comments, createdAt, mergedAt });

describe("receiptedMergesEvidence", () => {
	test("a merge counts only with a passed receipt for its merged head", () => {
		const prs = [
			merged(1, sha("a"), [comment(receipt(sha("a")))]),
			// Receipt for an earlier head: stale.
			merged(2, sha("b"), [comment(receipt(sha("c")))]),
			merged(3, sha("d")),
			merged(4, sha("e"), [comment(receipt(sha("e"), "failed"))]),
			// Anyone can post text: an untrusted author's receipt does not count.
			merged(5, sha("f"), [comment(receipt(sha("f")), "NONE")]),
		];
		expect(receiptedMergesEvidence(prs, LINK)).toEqual({
			link: LINK,
			since: null,
			merges: 5,
			receipted: 1,
			unreceipted: [
				"#2 (stale)",
				"#3 (missing)",
				"#4 (failing)",
				"#5 (missing)",
			],
			exempt: [],
		});
	});

	test("unreceipted merges are listed in PR order", () => {
		const prs = [merged(9, sha("a")), merged(7, sha("b"))];
		expect(receiptedMergesEvidence(prs, LINK).unreceipted).toEqual([
			"#7 (missing)",
			"#9 (missing)",
		]);
	});

	// #570: receipts became required with the merge of #371. A PR opened
	// before that merge could not have carried one; it is listed as exempt
	// and not counted. No PR can be opened in the past, so the set is closed.
	test("counts from the receipt-enforcement merge: PRs opened before it are exempt", () => {
		const enforcedAt = "2026-09-25T03:58:50Z";
		const prs = [
			// Opened and merged before enforcement.
			merged(367, sha("1"), [], "2026-09-25T02:30:05Z", "2026-09-25T02:34:56Z"),
			// The enforcement PR itself counts.
			merged(
				RECEIPTS_ENFORCED_BY,
				sha("2"),
				[comment(receipt(sha("2")))],
				"2026-09-25T03:04:49Z",
				enforcedAt,
			),
			// Opened before enforcement, merged after it.
			merged(376, sha("3"), [], "2026-09-25T03:21:13Z", "2026-09-25T04:44:16Z"),
			// Opened after enforcement: must carry a receipt.
			merged(
				378,
				sha("4"),
				[comment(receipt(sha("4")))],
				"2026-09-25T04:04:33Z",
				"2026-09-25T04:14:37Z",
			),
			merged(400, sha("5"), [], "2026-09-25T09:00:00Z", "2026-09-25T10:00:00Z"),
		];
		expect(receiptedMergesEvidence(prs, LINK)).toEqual({
			link: LINK,
			since: `#${RECEIPTS_ENFORCED_BY} (merged ${enforcedAt})`,
			merges: 3,
			receipted: 2,
			unreceipted: ["#400 (missing)"],
			exempt: ["#367", "#376"],
		});
	});

	test("receipt enforcement was enabled by the merge of #371", () => {
		expect(RECEIPTS_ENFORCED_BY).toBe(371);
	});

	test("without the enforcement merge among them, every merge counts", () => {
		const prs = [
			merged(1, sha("a"), [], "2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z"),
		];
		const r = receiptedMergesEvidence(prs, LINK);
		expect(r.since).toBeNull();
		expect(r.merges).toBe(1);
		expect(r.exempt).toEqual([]);
	});

	test("the grandfathered merges are exactly the seven that predate receipts", () => {
		expect(RECEIPTS_GRANDFATHERED).toEqual([366, 367, 369, 370, 373, 375, 376]);
	});

	// A PR opened before enforcement but closed unmerged could be reopened
	// and merged at any time; it is not grandfathered, so it must carry a
	// receipt. Only the seven merges that actually predate receipts are exempt.
	test("a pre-enforcement PR outside the grandfathered set still needs a receipt", () => {
		const enforcedAt = "2026-09-25T03:58:50Z";
		const prs = [
			merged(
				RECEIPTS_ENFORCED_BY,
				sha("2"),
				[comment(receipt(sha("2")))],
				"2026-09-25T03:04:49Z",
				enforcedAt,
			),
			// Opened before enforcement, reopened and merged much later.
			merged(360, sha("6"), [], "2026-09-24T12:00:00Z", "2026-10-20T10:00:00Z"),
		];
		const r = receiptedMergesEvidence(prs, LINK);
		expect(r.exempt).toEqual([]);
		expect(r.merges).toBe(2);
		expect(r.unreceipted).toEqual(["#360 (missing)"]);
	});
});
