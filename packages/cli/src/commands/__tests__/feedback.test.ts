import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	feedbackIngestAction,
	InvalidPrNumberError,
	parsePrNumbers,
} from "../feedback";

// ── parsePrNumbers ─────────────────────────────────────────────────────────

describe("parsePrNumbers", () => {
	test("returns [] for undefined", () => {
		expect(parsePrNumbers(undefined)).toEqual([]);
	});

	test("parses a single numeric token", () => {
		expect(parsePrNumbers(["123"])).toEqual([123]);
	});

	test("parses comma-separated tokens within one entry", () => {
		expect(parsePrNumbers(["1,2,3"])).toEqual([1, 2, 3]);
	});

	test("parses repeated --pr entries", () => {
		expect(parsePrNumbers(["1", "2", "3,4"])).toEqual([1, 2, 3, 4]);
	});

	test("throws InvalidPrNumberError on non-numeric token", () => {
		expect(() => parsePrNumbers(["foo"])).toThrow(InvalidPrNumberError);
	});

	test("throws on mixed valid + invalid token (must NOT fall back to auto-mode)", () => {
		// Critical case from CodeRabbit: `--pr foo,123` previously returned
		// [123] silently dropping foo. Now it throws.
		expect(() => parsePrNumbers(["1,foo"])).toThrow(InvalidPrNumberError);
	});

	test("throws on negative integer", () => {
		expect(() => parsePrNumbers(["-5"])).toThrow(InvalidPrNumberError);
	});

	test("throws on zero", () => {
		expect(() => parsePrNumbers(["0"])).toThrow(InvalidPrNumberError);
	});

	test("throws on decimal", () => {
		expect(() => parsePrNumbers(["1.5"])).toThrow(InvalidPrNumberError);
	});

	test("throws on empty token (e.g. trailing comma)", () => {
		expect(() => parsePrNumbers(["1,"])).toThrow(InvalidPrNumberError);
	});

	test("error message includes the offending token", () => {
		try {
			parsePrNumbers(["foo"]);
			throw new Error("expected to throw");
		} catch (e) {
			expect(e).toBeInstanceOf(InvalidPrNumberError);
			expect((e as Error).message).toContain("foo");
		}
	});
});

// ── feedbackIngestAction ───────────────────────────────────────────────────

describe("feedbackIngestAction", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(
			import.meta.dir,
			`tmp-feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	test("returns ok=false with error message when --pr contains invalid token", async () => {
		const result = await feedbackIngestAction(
			{
				repo: "mainahq/maina",
				pr: ["1,foo"],
				cwd: tmpDir,
			},
			{
				ingest: async () => ({ ok: true, value: { ingested: 0, skipped: 0 } }),
			},
		);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("foo");
		expect(result.ingested).toBe(0);
	});

	test("returns ok=false when the injected ingest fn fails", async () => {
		// Exercises the code path that CodeRabbit flagged — the action must
		// surface the error so the CLI caller can set process.exitCode=1.
		const result = await feedbackIngestAction(
			{
				repo: "mainahq/maina",
				pr: ["1"],
				cwd: tmpDir,
			},
			{
				ingest: async () => ({ ok: false, error: "gh rate-limited" }),
			},
		);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("gh rate-limited");
	});

	test("returns ok=true with stats when ingest succeeds", async () => {
		const result = await feedbackIngestAction(
			{
				repo: "mainahq/maina",
				pr: ["1"],
				cwd: tmpDir,
			},
			{
				ingest: async () => ({
					ok: true,
					value: { ingested: 3, skipped: 1 },
				}),
			},
		);
		expect(result.ok).toBe(true);
		expect(result.ingested).toBe(3);
		expect(result.skipped).toBe(1);
		expect(result.prNumbers).toEqual([1]);
	});

	test("reports prNumbers='auto' when no --pr given", async () => {
		const result = await feedbackIngestAction(
			{
				repo: "mainahq/maina",
				cwd: tmpDir,
			},
			{
				ingest: async () => ({
					ok: true,
					value: { ingested: 0, skipped: 0 },
				}),
			},
		);
		expect(result.ok).toBe(true);
		expect(result.prNumbers).toBe("auto");
	});
});
