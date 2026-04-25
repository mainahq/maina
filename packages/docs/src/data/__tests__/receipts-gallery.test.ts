import { describe, expect, it } from "bun:test";
import {
	buildGallery,
	type RawReceipt,
	receiptHref,
	toGalleryCard,
} from "../receipts-gallery";

const sampleHash = "a".repeat(64);

function rawReceipt(overrides: Partial<RawReceipt> = {}): RawReceipt {
	return {
		prTitle: "feat(x): a sample PR",
		repo: "mainahq/maina",
		timestamp: "2026-04-25T20:00:00.000Z",
		status: "passed",
		hash: sampleHash,
		walkthrough:
			"feat(x): a sample PR: +10 / −0 across 2 files. Maina ran 2 check(s) — 2 passed. Verified — passed 2 of 2 policy checks.",
		diff: { files: 2, additions: 10, deletions: 0 },
		checks: [{ status: "passed" }, { status: "passed" }],
		...overrides,
	};
}

describe("receipts-gallery", () => {
	it("returns empty array when no receipts are supplied", () => {
		expect(buildGallery([])).toEqual([]);
	});

	it("renders a status label that respects copy discipline (C2)", () => {
		const card = toGalleryCard(rawReceipt());
		expect(card?.statusLabel).toBe("passed 2 of 2 checks");
		// C2: never "0 findings" / "no issues found".
		expect(card?.statusLabel).not.toMatch(/\b(0 findings?|no issues? found)\b/);
	});

	it("only emits one of three known status badges", () => {
		const passed = toGalleryCard(rawReceipt({ status: "passed" }));
		const partial = toGalleryCard(rawReceipt({ status: "partial" }));
		const failed = toGalleryCard(rawReceipt({ status: "failed" }));
		expect(passed?.status).toBe("passed");
		expect(partial?.status).toBe("partial");
		expect(failed?.status).toBe("failed");
		// Bogus statuses → card dropped (not coerced to a wrong badge).
		expect(toGalleryCard(rawReceipt({ status: "totally-fine" }))).toBeNull();
	});

	it("links to /receipts/<hash>/ by default and to the chosen base when overridden", () => {
		const card = toGalleryCard(rawReceipt());
		expect(card?.href).toBe(`/receipts/${sampleHash}/`);
		const onR = toGalleryCard(rawReceipt(), { linkBase: "/r/" });
		expect(onR?.href).toBe(`/r/${sampleHash}/`);
		// Trailing-slash insensitivity.
		expect(receiptHref(sampleHash, "/receipts")).toBe(
			`/receipts/${sampleHash}/`,
		);
	});

	it("sorts newest-first and respects the limit", () => {
		const cards = buildGallery(
			[
				rawReceipt({
					hash: "1".repeat(64),
					timestamp: "2026-04-23T00:00:00.000Z",
				}),
				rawReceipt({
					hash: "2".repeat(64),
					timestamp: "2026-04-25T00:00:00.000Z",
				}),
				rawReceipt({
					hash: "3".repeat(64),
					timestamp: "2026-04-24T00:00:00.000Z",
				}),
			],
			{ limit: 2 },
		);
		expect(cards.map((c) => c.hash)).toEqual(["2".repeat(64), "3".repeat(64)]);
	});

	it("rejects non-ISO-8601 timestamps", () => {
		expect(toGalleryCard(rawReceipt({ timestamp: "yesterday" }))).toBeNull();
		expect(toGalleryCard(rawReceipt({ timestamp: "2026/04/25" }))).toBeNull();
		// Sanity: the canonical ISO form still parses.
		expect(
			toGalleryCard(rawReceipt({ timestamp: "2026-04-25T20:00:00.000Z" })),
		).not.toBeNull();
		// And the offset form is also valid ISO-8601.
		expect(
			toGalleryCard(rawReceipt({ timestamp: "2026-04-25T20:00:00+00:00" })),
		).not.toBeNull();
	});

	it("breaks ties on equal timestamps deterministically by hash", () => {
		const sameTime = "2026-04-25T20:00:00.000Z";
		const cards = buildGallery([
			rawReceipt({ hash: "b".repeat(64), timestamp: sameTime }),
			rawReceipt({ hash: "a".repeat(64), timestamp: sameTime }),
			rawReceipt({ hash: "c".repeat(64), timestamp: sameTime }),
		]);
		// All three timestamps tie; tie-break by hash ascending.
		expect(cards.map((c) => c.hash)).toEqual([
			"a".repeat(64),
			"b".repeat(64),
			"c".repeat(64),
		]);
	});

	it("drops malformed receipts instead of throwing", () => {
		// Missing required fields, bogus hash, wrong types — every one
		// should silently drop, leaving the surviving valid card alone.
		const cards = buildGallery([
			rawReceipt(),
			{ ...rawReceipt(), hash: "not-hex" },
			{ ...rawReceipt(), hash: undefined },
			{ ...rawReceipt(), prTitle: undefined },
			{ ...rawReceipt(), timestamp: 12345 as unknown as string },
		]);
		expect(cards).toHaveLength(1);
	});
});
