import { describe, expect, test } from "bun:test";
import {
	appendVerifiedByTrailer,
	computeProofHash,
	hasVerifiedByTrailer,
} from "../trailer";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

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
		const result = appendVerifiedByTrailer("feat: add thing", HASH);
		expect(result).toBe(
			`feat: add thing\n\nVerified-by: Maina@sha256:${HASH}\n`,
		);
	});

	test("appends to existing trailer block without extra blank line", () => {
		const msg = "feat: add thing\n\nCo-Authored-By: foo <foo@example.com>";
		const result = appendVerifiedByTrailer(msg, HASH);
		expect(result).toBe(
			`feat: add thing\n\nCo-Authored-By: foo <foo@example.com>\nVerified-by: Maina@sha256:${HASH}\n`,
		);
	});

	test("is idempotent — re-running with the same hash leaves one trailer", () => {
		const once = appendVerifiedByTrailer("feat: x", HASH);
		const twice = appendVerifiedByTrailer(once, HASH);
		expect(twice).toBe(once);
		expect(twice.match(/Verified-by:/g)?.length).toBe(1);
	});

	test("replaces an existing trailer with a different hash", () => {
		const original = appendVerifiedByTrailer("feat: x", HASH);
		const updated = appendVerifiedByTrailer(original, HASH2);
		expect(updated).toContain(`Verified-by: Maina@sha256:${HASH2}`);
		expect(updated).not.toContain(`Verified-by: Maina@sha256:${HASH}`);
		expect(updated.match(/Verified-by:/g)?.length).toBe(1);
	});

	test("rejects an invalid hash", () => {
		expect(() => appendVerifiedByTrailer("feat: x", "not-a-hash")).toThrow();
	});

	test("handles a body paragraph between subject and trailers", () => {
		const msg = "feat: x\n\nThis is a body paragraph with details.";
		const result = appendVerifiedByTrailer(msg, HASH);
		expect(result).toBe(
			`feat: x\n\nThis is a body paragraph with details.\n\nVerified-by: Maina@sha256:${HASH}\n`,
		);
	});

	test("handles empty input", () => {
		expect(appendVerifiedByTrailer("", HASH)).toBe(
			`Verified-by: Maina@sha256:${HASH}\n`,
		);
	});
});

describe("computeProofHash", () => {
	test("produces a stable sha256 hex string", () => {
		const h = computeProofHash({ passed: true, tools: 13 });
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(computeProofHash({ tools: 13, passed: true })).toBe(h);
	});

	test("differs when input changes", () => {
		const a = computeProofHash({ passed: true });
		const b = computeProofHash({ passed: false });
		expect(a).not.toBe(b);
	});
});
