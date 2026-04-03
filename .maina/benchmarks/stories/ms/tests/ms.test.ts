/**
 * Ground-truth tests for ms duration utility.
 * Adapted from https://github.com/vercel/ms/tree/main/tests
 * Ported to bun:test. Implementation path injected via MS_IMPL_PATH env var.
 */
import { describe, expect, test } from "bun:test";

const implPath = process.env.MS_IMPL_PATH ?? "../ms";
const mod = await import(implPath);
const ms = mod.default;

// ── Parse: string → number ──────────────────────────────────────────────────

describe("ms(string) — parse", () => {
	describe("short units", () => {
		test("100ms → 100", () => expect(ms("100ms")).toBe(100));
		test("1s → 1000", () => expect(ms("1s")).toBe(1000));
		test("1m → 60000", () => expect(ms("1m")).toBe(60_000));
		test("1h → 3600000", () => expect(ms("1h")).toBe(3_600_000));
		test("1d → 86400000", () => expect(ms("1d")).toBe(86_400_000));
		test("1w → 604800000", () => expect(ms("1w")).toBe(604_800_000));
		test("1y → 31557600000", () => expect(ms("1y")).toBe(31_557_600_000));
	});

	describe("long units", () => {
		test("1 second", () => expect(ms("1 second")).toBe(1000));
		test("1 minute", () => expect(ms("1 minute")).toBe(60_000));
		test("1 hour", () => expect(ms("1 hour")).toBe(3_600_000));
		test("1 day", () => expect(ms("1 day")).toBe(86_400_000));
		test("1 week", () => expect(ms("1 week")).toBe(604_800_000));
		test("1 year", () => expect(ms("1 year")).toBe(31_557_600_000));
		test("1 month", () => expect(ms("1 month")).toBe(2_629_800_000));
	});

	describe("plural units", () => {
		test("2 seconds", () => expect(ms("2 seconds")).toBe(2000));
		test("2 minutes", () => expect(ms("2 minutes")).toBe(120_000));
		test("2 hours", () => expect(ms("2 hours")).toBe(7_200_000));
		test("2 days", () => expect(ms("2 days")).toBe(172_800_000));
	});

	describe("decimals", () => {
		test("1.5h → 5400000", () => expect(ms("1.5h")).toBe(5_400_000));
		test(".5m → 30000", () => expect(ms(".5m")).toBe(30_000));
		test(".5h → 1800000", () => expect(ms(".5h")).toBe(1_800_000));
	});

	describe("negative values", () => {
		test("-1h → -3600000", () => expect(ms("-1h")).toBe(-3_600_000));
		test("-1.5h → -5400000", () => expect(ms("-1.5h")).toBe(-5_400_000));
		test("-.5h → -1800000", () => expect(ms("-.5h")).toBe(-1_800_000));
	});

	describe("case insensitive", () => {
		test("1H → 3600000", () => expect(ms("1H")).toBe(3_600_000));
		test("1D → 86400000", () => expect(ms("1D")).toBe(86_400_000));
	});

	describe("bare number", () => {
		test("'100' → 100", () => expect(ms("100")).toBe(100));
		test("'0' → 0", () => expect(ms("0")).toBe(0));
	});

	describe("returns NaN for invalid", () => {
		test("unparseable string", () => expect(ms("foo")).toBeNaN());
		test("emoji", () => expect(ms("☃")).toBeNaN());
		test("malformed number", () => expect(ms("10-.5")).toBeNaN());
	});
});

// ── Format: number → string ─────────────────────────────────────────────────

describe("ms(number) — format short", () => {
	test("500 → '500ms'", () => expect(ms(500)).toBe("500ms"));
	test("1000 → '1s'", () => expect(ms(1000)).toBe("1s"));
	test("60000 → '1m'", () => expect(ms(60_000)).toBe("1m"));
	test("3600000 → '1h'", () => expect(ms(3_600_000)).toBe("1h"));
	test("86400000 → '1d'", () => expect(ms(86_400_000)).toBe("1d"));
	test("-60000 → '-1m'", () => expect(ms(-60_000)).toBe("-1m"));
	test("234234234 → '3d'", () => expect(ms(234_234_234)).toBe("3d"));
});

describe("ms(number, { long: true }) — format long", () => {
	test("500 → '500 ms'", () => expect(ms(500, { long: true })).toBe("500 ms"));
	test("1000 → '1 second'", () =>
		expect(ms(1000, { long: true })).toBe("1 second"));
	test("1200 → '1 second'", () =>
		expect(ms(1200, { long: true })).toBe("1 second"));
	test("2000 → '2 seconds'", () =>
		expect(ms(2000, { long: true })).toBe("2 seconds"));
	test("60000 → '1 minute'", () =>
		expect(ms(60_000, { long: true })).toBe("1 minute"));
	test("120000 → '2 minutes'", () =>
		expect(ms(120_000, { long: true })).toBe("2 minutes"));
	test("3600000 → '1 hour'", () =>
		expect(ms(3_600_000, { long: true })).toBe("1 hour"));
	test("7200000 → '2 hours'", () =>
		expect(ms(7_200_000, { long: true })).toBe("2 hours"));
	test("86400000 → '1 day'", () =>
		expect(ms(86_400_000, { long: true })).toBe("1 day"));
	test("172800000 → '2 days'", () =>
		expect(ms(172_800_000, { long: true })).toBe("2 days"));
	test("-3600000 → '-1 hour'", () =>
		expect(ms(-3_600_000, { long: true })).toBe("-1 hour"));
});

// ── Error handling ──────────────────────────────────────────────────────────

describe("ms() — errors", () => {
	test("throws on empty string", () => {
		expect(() => ms("")).toThrow();
	});
	test("throws on string > 100 chars", () => {
		expect(() => ms("a".repeat(101))).toThrow();
	});
	test("throws on undefined", () => {
		expect(() => ms(undefined as unknown as string)).toThrow();
	});
	test("throws on null", () => {
		expect(() => ms(null as unknown as string)).toThrow();
	});
	test("throws on boolean", () => {
		expect(() => ms(true as unknown as string)).toThrow();
	});
	test("throws on NaN input", () => {
		expect(() => ms(Number.NaN)).toThrow();
	});
	test("throws on Infinity", () => {
		expect(() => ms(Number.POSITIVE_INFINITY)).toThrow();
	});
});
