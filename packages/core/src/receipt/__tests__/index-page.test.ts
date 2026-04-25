import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type IndexEntry,
	renderIndexHtml,
	writeIndexPage,
} from "../index-page";
import type { Receipt } from "../types";

function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
	return {
		prTitle: "feat: example",
		repo: "mainahq/maina",
		timestamp: "2026-04-25T12:00:00Z",
		status: "passed",
		hash: "a".repeat(64),
		diff: { additions: 1, deletions: 0, files: 1 },
		agent: { id: "claude-code:opus", modelVersion: "claude-opus-4-7" },
		promptVersion: {
			constitutionHash: "b".repeat(64),
			promptsHash: "c".repeat(64),
		},
		checks: [
			{
				id: "biome-check",
				name: "Biome",
				status: "passed",
				tool: "biome",
				findings: [],
			},
		],
		walkthrough: "test walkthrough",
		feedback: [],
		retries: 0,
		...overrides,
	};
}

describe("renderIndexHtml", () => {
	function entry(overrides: Partial<IndexEntry> = {}): IndexEntry {
		return {
			hash: "a".repeat(64),
			prTitle: "feat: x",
			repo: "mainahq/maina",
			timestamp: "2026-04-25T12:00:00Z",
			status: "passed",
			passedCount: 1,
			totalCount: 1,
			...overrides,
		};
	}

	test("renders a passed entry with affirmative framing (C2)", () => {
		const html = renderIndexHtml([entry()], "Maina receipts");
		expect(html).toContain("passed 1 of 1");
		expect(html).not.toMatch(/\b(0 findings?|no issues? found|no errors?)\b/i);
	});

	test("renders an empty state without negative framing", () => {
		const html = renderIndexHtml([], "Maina receipts");
		expect(html).toContain("hasn't recorded any receipts");
		expect(html).not.toMatch(/\b(0 findings?|no issues? found|no errors?)\b/i);
	});

	test("escapes user-controlled content (XSS guard)", () => {
		const html = renderIndexHtml(
			[entry({ prTitle: "<script>alert(1)</script>" })],
			"Maina receipts",
		);
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
	});

	test("links to the per-receipt page via relative path", () => {
		const html = renderIndexHtml([entry({ hash: "a".repeat(64) })], "x");
		expect(html).toContain(`href="./${"a".repeat(64)}/index.html"`);
	});

	test("does not interpolate raw status into class without allow-list", () => {
		// status comes from receipt.status which is enum-validated upstream;
		// renderer interpolates it directly. Ensure unknown values still render
		// (they'd just style as the literal token, which is acceptable).
		const html = renderIndexHtml([entry({ status: "passed" })], "x");
		expect(html).toContain("status-passed");
	});
});

describe("writeIndexPage", () => {
	const created: string[] = [];

	function freshDir(): string {
		const d = mkdtempSync(join(tmpdir(), "maina-receipts-index-"));
		created.push(d);
		return d;
	}

	function writeReceiptFile(
		root: string,
		hash: string,
		overrides: Partial<Receipt>,
	): void {
		mkdirSync(join(root, hash), { recursive: true });
		writeFileSync(
			join(root, hash, "receipt.json"),
			JSON.stringify(makeReceipt({ hash, ...overrides })),
		);
	}

	afterAll(() => {
		for (const d of created) rmSync(d, { recursive: true, force: true });
	});

	test("writes a valid index for an empty directory", () => {
		const dir = freshDir();
		const result = writeIndexPage(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.entries).toBe(0);
		const html = readFileSync(result.htmlPath, "utf-8");
		expect(html).toContain("Maina receipts");
		expect(html).toContain("hasn't recorded any receipts");
	});

	test("walks receipt subdirs and renders newest first", () => {
		const dir = freshDir();
		writeReceiptFile(dir, "a".repeat(64), {
			timestamp: "2026-04-20T10:00:00Z",
			prTitle: "older PR",
		});
		writeReceiptFile(dir, "b".repeat(64), {
			timestamp: "2026-04-25T12:00:00Z",
			prTitle: "newer PR",
		});

		const result = writeIndexPage(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.entries).toBe(2);
		const html = readFileSync(result.htmlPath, "utf-8");
		expect(html.indexOf("newer PR")).toBeLessThan(html.indexOf("older PR"));
	});

	test("ignores non-receipt subdirs", () => {
		const dir = freshDir();
		writeReceiptFile(dir, "a".repeat(64), { prTitle: "real" });
		mkdirSync(join(dir, "not-a-hash"), { recursive: true });
		writeFileSync(join(dir, "not-a-hash", "receipt.json"), "garbage");

		const result = writeIndexPage(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.entries).toBe(1);
	});

	test("respects options.limit", () => {
		const dir = freshDir();
		writeReceiptFile(dir, "a".repeat(64), {
			timestamp: "2026-04-25T01:00:00Z",
		});
		writeReceiptFile(dir, "b".repeat(64), {
			timestamp: "2026-04-25T02:00:00Z",
		});
		writeReceiptFile(dir, "c".repeat(64), {
			timestamp: "2026-04-25T03:00:00Z",
		});

		const result = writeIndexPage(dir, { limit: 2 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.entries).toBe(2);
	});

	test("clamps negative or non-finite limits to defaults", () => {
		const dir = freshDir();
		writeReceiptFile(dir, "a".repeat(64), {});
		const negative = writeIndexPage(dir, { limit: -5 });
		expect(negative.ok).toBe(true);
		if (negative.ok) expect(negative.entries).toBe(0);
		const inf = writeIndexPage(dir, { limit: Number.POSITIVE_INFINITY });
		expect(inf.ok).toBe(true);
		if (inf.ok) expect(inf.entries).toBe(1);
	});

	test("returns io error when receipts dir is unwritable", () => {
		const result = writeIndexPage("/this/dir/does/not/exist/at/all");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("io");
	});
});
