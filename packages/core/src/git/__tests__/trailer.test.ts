import { describe, expect, test } from "bun:test";
import {
	appendVerifiedByTrailer,
	computeProofHash,
	hasVerifiedByTrailer,
} from "../trailer";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

function unwrapAppend(message: string, hash: string): string {
	const result = appendVerifiedByTrailer(message, hash);
	if (!result.ok)
		throw new Error(`unexpected append failure: ${result.message}`);
	return result.data;
}

function unwrapHash(value: unknown): string {
	const result = computeProofHash(value);
	if (!result.ok) throw new Error(`unexpected hash failure: ${result.message}`);
	return result.data;
}

describe("hasVerifiedByTrailer", () => {
	test("detects a present trailer", () => {
		expect(
			hasVerifiedByTrailer(`feat: x\n\nVerified-by: Maina@sha256:${HASH}\n`),
		).toBe(true);
	});

	test("returns false when absent", () => {
		expect(hasVerifiedByTrailer("feat: x\n")).toBe(false);
	});

	test("rejects malformed trailer", () => {
		expect(hasVerifiedByTrailer("feat: x\n\nVerified-by: maina@xxxx")).toBe(
			false,
		);
	});
});

describe("appendVerifiedByTrailer", () => {
	test("appends with blank-line separator on a subject-only message", () => {
		expect(unwrapAppend("feat: add thing", HASH)).toBe(
			`feat: add thing\n\nVerified-by: Maina@sha256:${HASH}\n`,
		);
	});

	test("appends to existing trailer block without extra blank line", () => {
		const msg = "feat: add thing\n\nCo-Authored-By: foo <foo@example.com>";
		expect(unwrapAppend(msg, HASH)).toBe(
			`feat: add thing\n\nCo-Authored-By: foo <foo@example.com>\nVerified-by: Maina@sha256:${HASH}\n`,
		);
	});

	test("is idempotent — re-running with the same hash leaves one trailer", () => {
		const once = unwrapAppend("feat: x", HASH);
		const twice = unwrapAppend(once, HASH);
		expect(twice).toBe(once);
		expect(twice.match(/Verified-by:/g)?.length).toBe(1);
	});

	test("replaces an existing trailer with a different hash", () => {
		const original = unwrapAppend("feat: x", HASH);
		const updated = unwrapAppend(original, HASH2);
		expect(updated).toContain(`Verified-by: Maina@sha256:${HASH2}`);
		expect(updated).not.toContain(`Verified-by: Maina@sha256:${HASH}`);
		expect(updated.match(/Verified-by:/g)?.length).toBe(1);
	});

	test("collapses multiple existing Verified-by trailers into one", () => {
		const messy = `feat: x\n\nVerified-by: Maina@sha256:${HASH}\nCo-Authored-By: foo\nVerified-by: Maina@sha256:${"c".repeat(64)}\n`;
		const cleaned = unwrapAppend(messy, HASH2);
		expect(cleaned.match(/Verified-by:/g)?.length).toBe(1);
		expect(cleaned).toContain(`Verified-by: Maina@sha256:${HASH2}`);
		expect(cleaned).toContain("Co-Authored-By: foo");
	});

	test("returns Result error for an invalid hash", () => {
		const result = appendVerifiedByTrailer("feat: x", "not-a-hash");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("invalid-hash");
	});

	test("handles a body paragraph between subject and trailers", () => {
		const msg = "feat: x\n\nThis is a body paragraph with details.";
		expect(unwrapAppend(msg, HASH)).toBe(
			`feat: x\n\nThis is a body paragraph with details.\n\nVerified-by: Maina@sha256:${HASH}\n`,
		);
	});

	test("handles empty input", () => {
		expect(unwrapAppend("", HASH)).toBe(`Verified-by: Maina@sha256:${HASH}\n`);
	});
});

describe("computeProofHash", () => {
	test("produces a stable sha256 hex string", () => {
		const h = unwrapHash({ passed: true, tools: 13 });
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(unwrapHash({ tools: 13, passed: true })).toBe(h);
	});

	test("differs when input changes", () => {
		expect(unwrapHash({ passed: true })).not.toBe(
			unwrapHash({ passed: false }),
		);
	});

	test("returns Result error when canonicalization fails", () => {
		const result = computeProofHash({ bad: BigInt(1) });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("canonicalize-failed");
	});
});
