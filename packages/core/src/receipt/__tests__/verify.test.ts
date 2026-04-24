import { describe, expect, test } from "bun:test";
import { canonicalize } from "../canonical";
import type { Receipt } from "../types";
import { computeHash, verifyReceipt } from "../verify";

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

function unwrapHash(receipt: Omit<Receipt, "hash">): string {
	const result = computeHash(receipt);
	if (!result.ok) throw new Error(`computeHash failed: ${result.message}`);
	return result.data;
}

function signed(receipt: Omit<Receipt, "hash">): Receipt {
	return { ...receipt, hash: unwrapHash(receipt) };
}

function unwrapCanonical(value: unknown): string {
	const result = canonicalize(value);
	if (!result.ok) throw new Error(`canonicalize failed: ${result.message}`);
	return result.data;
}

describe("canonicalize", () => {
	test("sorts object keys lexicographically", () => {
		expect(unwrapCanonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
	});

	test("recurses into nested objects", () => {
		expect(unwrapCanonical({ outer: { z: 1, a: 2 } })).toBe(
			'{"outer":{"a":2,"z":1}}',
		);
	});

	test("preserves array order", () => {
		expect(unwrapCanonical([3, 1, 2])).toBe("[3,1,2]");
	});

	test("handles primitives", () => {
		expect(unwrapCanonical(null)).toBe("null");
		expect(unwrapCanonical(true)).toBe("true");
		expect(unwrapCanonical(false)).toBe("false");
		expect(unwrapCanonical(42)).toBe("42");
		expect(unwrapCanonical("hi")).toBe('"hi"');
	});

	test("skips undefined values in objects", () => {
		expect(unwrapCanonical({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
	});

	test("returns structured error for non-finite numbers", () => {
		const nanResult = canonicalize(NaN);
		expect(nanResult.ok).toBe(false);
		if (!nanResult.ok) expect(nanResult.code).toBe("non-finite-number");

		const infResult = canonicalize(Infinity);
		expect(infResult.ok).toBe(false);
	});

	test("returns structured error for unsupported types (bigint)", () => {
		const result = canonicalize({ big: BigInt(1) });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("unsupported-type");
	});
});

describe("computeHash", () => {
	test("is deterministic", () => {
		const r = baseReceipt();
		expect(unwrapHash(r)).toBe(unwrapHash(r));
	});

	test("changes when fields change", () => {
		const r1 = baseReceipt();
		const r2 = { ...baseReceipt(), retries: 1 };
		expect(unwrapHash(r1)).not.toBe(unwrapHash(r2));
	});

	test("is independent of key order in input", () => {
		const r = baseReceipt();
		const reordered = {
			retries: r.retries,
			feedback: r.feedback,
			walkthrough: r.walkthrough,
			checks: r.checks,
			promptVersion: r.promptVersion,
			agent: r.agent,
			diff: r.diff,
			status: r.status,
			timestamp: r.timestamp,
			repo: r.repo,
			prTitle: r.prTitle,
		} as Omit<Receipt, "hash">;
		expect(unwrapHash(r)).toBe(unwrapHash(reordered));
	});

	test("surfaces canonicalize failure as structured error", () => {
		const bad = {
			...baseReceipt(),
			agent: { id: "x", modelVersion: NaN },
		} as never;
		const result = computeHash(bad as Omit<Receipt, "hash">);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("canonicalize-failed");
	});
});

describe("verifyReceipt", () => {
	test("passes on a well-formed receipt", () => {
		const r = signed(baseReceipt());
		const result = verifyReceipt(r);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe("passed");
	});

	test("rejects non-object input", () => {
		expect(verifyReceipt("string").ok).toBe(false);
		expect(verifyReceipt(42).ok).toBe(false);
		expect(verifyReceipt(null).ok).toBe(false);
		expect(verifyReceipt([]).ok).toBe(false);
	});

	test("rejects missing required field", () => {
		const r = signed(baseReceipt()) as Partial<Receipt>;
		delete r.retries;
		const result = verifyReceipt(r);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("missing-field");
	});

	test("rejects invalid status value", () => {
		const bad = { ...baseReceipt(), status: "unknown" as never };
		const result = verifyReceipt(signed(bad));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-field");
	});

	test("rejects malformed hash", () => {
		const r = { ...signed(baseReceipt()), hash: "not-hex" };
		const result = verifyReceipt(r);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-hash-format");
	});

	test("rejects hash mismatch", () => {
		const r = {
			...signed(baseReceipt()),
			hash: "0".repeat(64),
		};
		const result = verifyReceipt(r);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("hash-mismatch");
	});

	test("rejects retries not an integer", () => {
		const bad = { ...baseReceipt(), retries: 1.5 };
		const result = verifyReceipt(signed(bad));
		expect(result.ok).toBe(false);
	});

	test("rejects negative retries", () => {
		const bad = { ...baseReceipt(), retries: -1 };
		const result = verifyReceipt(signed(bad));
		expect(result.ok).toBe(false);
	});

	test("rejects unknown tool enum value", () => {
		const bad: Omit<Receipt, "hash"> = {
			...baseReceipt(),
			checks: [
				{
					id: "fake-check",
					name: "Fake tool",
					status: "passed",
					tool: "fake" as never,
					findings: [],
				},
			],
		};
		const result = verifyReceipt(signed(bad));
		expect(result.ok).toBe(false);
	});

	test("rejects invalid repo format", () => {
		const bad = { ...baseReceipt(), repo: "not-owner-slash-name" };
		const result = verifyReceipt(signed(bad));
		expect(result.ok).toBe(false);
	});

	test("accepts optional check.patch", () => {
		const withPatch: Omit<Receipt, "hash"> = {
			...baseReceipt(),
			checks: [
				{
					id: "biome-check",
					name: "Biome",
					status: "failed",
					tool: "biome",
					findings: [
						{
							severity: "error",
							file: "src/a.ts",
							line: 1,
							message: "nope",
						},
					],
					patch: {
						diff: "a/b",
						rationale: "auto-fix",
					},
				},
			],
		};
		const result = verifyReceipt(signed(withPatch));
		expect(result.ok).toBe(true);
	});
});
