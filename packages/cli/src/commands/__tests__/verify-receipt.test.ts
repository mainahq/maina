import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeReceiptHash, type Receipt } from "@mainahq/core";
import { verifyReceiptAction } from "../verify-receipt";

function baseReceipt(): Omit<Receipt, "hash"> {
	return {
		prTitle: "example PR",
		repo: "mainahq/maina",
		timestamp: "2026-04-25T12:00:00Z",
		status: "passed",
		diff: { additions: 10, deletions: 2, files: 1 },
		agent: { id: "claude-code:opus", modelVersion: "claude-opus-4-7" },
		promptVersion: {
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		},
		checks: [
			{
				id: "biome-check",
				name: "Biome lint + format",
				status: "passed",
				tool: "biome",
				findings: [],
			},
		],
		walkthrough: "Added one field. Tests green. No policy drift.",
		feedback: [],
		retries: 0,
	};
}

function signed(receipt: Omit<Receipt, "hash">): Receipt {
	const hash = computeReceiptHash(receipt);
	if (!hash.ok) throw new Error(`computeReceiptHash failed: ${hash.message}`);
	return { ...receipt, hash: hash.data };
}

describe("verifyReceiptAction", () => {
	let dir: string;

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "maina-verify-receipt-"));
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("happy path — signed receipt verifies", () => {
		const path = join(dir, "ok.json");
		writeFileSync(path, JSON.stringify(signed(baseReceipt())));
		const result = verifyReceiptAction(path);
		expect(result.ok).toBe(true);
		expect(result.passedCount).toBe(1);
		expect(result.totalCount).toBe(1);
		expect(result.status).toBe("passed");
	});

	test("reports io error on missing file", () => {
		const result = verifyReceiptAction(join(dir, "nope.json"));
		expect(result.ok).toBe(false);
		expect(result.code).toBe("io");
	});

	test("reports io error on malformed JSON", () => {
		const path = join(dir, "bad.json");
		writeFileSync(path, "{not-json");
		const result = verifyReceiptAction(path);
		expect(result.ok).toBe(false);
		expect(result.code).toBe("io");
	});

	test("reports hash mismatch", () => {
		const path = join(dir, "tampered.json");
		const r = signed(baseReceipt());
		writeFileSync(
			path,
			JSON.stringify({ ...r, prTitle: "changed after sign" }),
		);
		const result = verifyReceiptAction(path);
		expect(result.ok).toBe(false);
		expect(result.code).toBe("hash-mismatch");
	});

	test("reports shape error on missing field", () => {
		const path = join(dir, "incomplete.json");
		const r = signed(baseReceipt()) as Partial<Receipt>;
		delete r.retries;
		writeFileSync(path, JSON.stringify(r));
		const result = verifyReceiptAction(path);
		expect(result.ok).toBe(false);
		expect(result.code).toBe("missing-field");
	});

	test("resolves relative paths against cwd option", () => {
		const path = join(dir, "cwd.json");
		writeFileSync(path, JSON.stringify(signed(baseReceipt())));
		const result = verifyReceiptAction("cwd.json", { cwd: dir });
		expect(result.ok).toBe(true);
	});
});
