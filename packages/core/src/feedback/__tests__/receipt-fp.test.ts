import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	countReceiptFpsByCheck,
	queryReceiptFps,
	recordReceiptFp,
} from "../receipt-fp";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_RECEIPT = "c".repeat(64);

describe("recordReceiptFp", () => {
	let mainaDir: string;

	beforeEach(() => {
		mainaDir = mkdtempSync(join(tmpdir(), "maina-fp-"));
	});

	afterEach(() => {
		rmSync(mainaDir, { recursive: true, force: true });
	});

	test("writes a row with the supplied fields", () => {
		const result = recordReceiptFp({
			checkId: "biome-check",
			reason: "false positive — internal style choice",
			constitutionHash: HASH_A,
			receiptHash: HASH_RECEIPT,
			mainaDir,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.checkId).toBe("biome-check");
		expect(result.data.constitutionHash).toBe(HASH_A);
		expect(result.data.receiptHash).toBe(HASH_RECEIPT);
		expect(result.data.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("trims whitespace on checkId + reason", () => {
		const result = recordReceiptFp({
			checkId: "  semgrep-check  ",
			reason: "  noisy rule  ",
			constitutionHash: HASH_A,
			mainaDir,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.checkId).toBe("semgrep-check");
		expect(result.data.reason).toBe("noisy rule");
	});

	test("rejects empty checkId", () => {
		const result = recordReceiptFp({
			checkId: "   ",
			reason: "x",
			constitutionHash: HASH_A,
			mainaDir,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-check-id");
	});

	test("rejects empty reason", () => {
		const result = recordReceiptFp({
			checkId: "x",
			reason: "  ",
			constitutionHash: HASH_A,
			mainaDir,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-reason");
	});

	test("rejects malformed constitutionHash", () => {
		const result = recordReceiptFp({
			checkId: "x",
			reason: "y",
			constitutionHash: "not-hex",
			mainaDir,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-hash");
	});

	test("rejects malformed receiptHash when provided", () => {
		const result = recordReceiptFp({
			checkId: "x",
			reason: "y",
			constitutionHash: HASH_A,
			receiptHash: "tampered",
			mainaDir,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-hash");
	});

	test("permits omitting receiptHash entirely", () => {
		const result = recordReceiptFp({
			checkId: "x",
			reason: "y",
			constitutionHash: HASH_A,
			mainaDir,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.receiptHash).toBeNull();
	});
});

describe("queryReceiptFps", () => {
	let mainaDir: string;

	beforeEach(() => {
		mainaDir = mkdtempSync(join(tmpdir(), "maina-fp-q-"));
		recordReceiptFp({
			checkId: "biome-check",
			reason: "noisy",
			constitutionHash: HASH_A,
			mainaDir,
		});
		recordReceiptFp({
			checkId: "biome-check",
			reason: "still noisy",
			constitutionHash: HASH_A,
			mainaDir,
		});
		recordReceiptFp({
			checkId: "semgrep-check",
			reason: "fp",
			constitutionHash: HASH_A,
			mainaDir,
		});
		recordReceiptFp({
			checkId: "biome-check",
			reason: "different policy",
			constitutionHash: HASH_B,
			mainaDir,
		});
	});

	afterEach(() => {
		rmSync(mainaDir, { recursive: true, force: true });
	});

	test("returns every record when called without filters", () => {
		const result = queryReceiptFps({ mainaDir });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toHaveLength(4);
	});

	test("filters by constitutionHash", () => {
		const result = queryReceiptFps({
			constitutionHash: HASH_A,
			mainaDir,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toHaveLength(3);
		for (const r of result.data) {
			expect(r.constitutionHash).toBe(HASH_A);
		}
	});

	test("filters by checkId + constitutionHash together", () => {
		const result = queryReceiptFps({
			checkId: "biome-check",
			constitutionHash: HASH_A,
			mainaDir,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toHaveLength(2);
	});

	test("rejects malformed constitutionHash with invalid-hash code", () => {
		const result = queryReceiptFps({
			constitutionHash: "garbage",
			mainaDir,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-hash");
	});
});

describe("countReceiptFpsByCheck", () => {
	let mainaDir: string;

	beforeEach(() => {
		mainaDir = mkdtempSync(join(tmpdir(), "maina-fp-c-"));
		recordReceiptFp({
			checkId: "biome-check",
			reason: "x",
			constitutionHash: HASH_A,
			mainaDir,
		});
		recordReceiptFp({
			checkId: "biome-check",
			reason: "y",
			constitutionHash: HASH_A,
			mainaDir,
		});
		recordReceiptFp({
			checkId: "semgrep-check",
			reason: "z",
			constitutionHash: HASH_A,
			mainaDir,
		});
		recordReceiptFp({
			checkId: "biome-check",
			reason: "different policy",
			constitutionHash: HASH_B,
			mainaDir,
		});
	});

	afterEach(() => {
		rmSync(mainaDir, { recursive: true, force: true });
	});

	test("aggregates counts per check for a single constitution", () => {
		const result = countReceiptFpsByCheck(HASH_A, mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.get("biome-check")).toBe(2);
		expect(result.data.get("semgrep-check")).toBe(1);
		expect(result.data.size).toBe(2);
	});

	test("does not bleed counts from a different constitution", () => {
		const result = countReceiptFpsByCheck(HASH_B, mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.get("biome-check")).toBe(1);
		expect(result.data.size).toBe(1);
	});

	test("rejects malformed constitutionHash with structured error", () => {
		const result = countReceiptFpsByCheck("garbage", mainaDir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-hash");
	});
});
