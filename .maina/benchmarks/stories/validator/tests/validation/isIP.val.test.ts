/**
 * VALIDATION tests for isIP — hidden from AI during implementation.
 * Edge cases, boundary conditions, and tricky formats.
 */
import { describe, expect, test } from "bun:test";

const implPath = process.env.VALIDATOR_IMPL_PATH ?? "../validator";
const mod = await import(implPath);
const { isIP } = mod;

// -- IPv4 edge cases ----------------------------------------------------------

describe("isIP validation — IPv4 edges", () => {
	test("leading zeros rejected (octal ambiguity)", () => {
		expect(isIP("01.02.03.04")).toBe(false);
	});

	test("single leading zero rejected", () => {
		expect(isIP("01.0.0.1")).toBe(false);
	});

	test("255.255.255.254 boundary", () => {
		expect(isIP("255.255.255.254")).toBe(true);
	});

	test("too many octets", () => {
		expect(isIP("1.2.3.4.5")).toBe(false);
	});

	test("trailing dot", () => {
		expect(isIP("192.168.1.1.")).toBe(false);
	});

	test("leading dot", () => {
		expect(isIP(".192.168.1.1")).toBe(false);
	});

	test("negative number in octet", () => {
		expect(isIP("-1.0.0.0")).toBe(false);
	});

	test("IPv4 with port notation is not an IP", () => {
		expect(isIP("192.168.1.1:80")).toBe(false);
	});

	test("space in address", () => {
		expect(isIP("192.168.1. 1")).toBe(false);
	});
});

// -- IPv6 edge cases ----------------------------------------------------------

describe("isIP validation — IPv6 edges", () => {
	test("all zeros shorthand", () => {
		expect(isIP("::")).toBe(true);
	});

	test("abbreviated form", () => {
		expect(isIP("2001:db8:85a3::8a2e:370:7334")).toBe(true);
	});

	test("mixed IPv4-mapped", () => {
		expect(isIP("::ffff:192.168.1.1")).toBe(true);
	});

	test("invalid hex characters", () => {
		expect(isIP("2001:xyz::1")).toBe(false);
	});

	test("multiple double-colon (invalid)", () => {
		expect(isIP("2001::85a3::1")).toBe(false);
	});

	test("mixed IPv4-mapped with invalid IPv4 part", () => {
		expect(isIP("::ffff:999.999.999.999")).toBe(false);
	});

	test("case-insensitive hex", () => {
		expect(isIP("2001:DB8::1")).toBe(true);
	});

	test("single colon at start (invalid)", () => {
		expect(isIP(":2001:db8::1")).toBe(false);
	});

	test("group with 5 hex digits (invalid)", () => {
		expect(isIP("2001:0db8:85a3:00000:0:8a2e:370:7334")).toBe(false);
	});
});

// -- Input type and boundary --------------------------------------------------

describe("isIP validation — type safety", () => {
	test("empty string", () => {
		expect(isIP("")).toBe(false);
	});

	test("whitespace-only", () => {
		expect(isIP("   ")).toBe(false);
	});

	test("null input", () => {
		expect(isIP(null as unknown as string)).toBe(false);
	});

	test("undefined input", () => {
		expect(isIP(undefined as unknown as string)).toBe(false);
	});

	test("number input", () => {
		expect(isIP(12345 as unknown as string)).toBe(false);
	});

	test("random string", () => {
		expect(isIP("not-an-ip")).toBe(false);
	});
});

// -- Version filtering edge cases ---------------------------------------------

describe("isIP validation — version filter edges", () => {
	test("mixed IPv4-mapped passes version 6", () => {
		expect(isIP("::ffff:192.168.1.1", 6)).toBe(true);
	});

	test("mixed IPv4-mapped fails version 4", () => {
		expect(isIP("::ffff:192.168.1.1", 4)).toBe(false);
	});

	test("no version accepts both v4 and v6", () => {
		expect(isIP("10.0.0.1")).toBe(true);
		expect(isIP("fe80::1")).toBe(true);
	});
});
