/**
 * Training tests for isIP validator.
 * These are given to the AI during implementation — straightforward cases only.
 */
import { describe, expect, test } from "bun:test";

const implPath = process.env.VALIDATOR_IMPL_PATH ?? "../validator";
const mod = await import(implPath);
const { isIP } = mod;

describe("isIP — valid IPv4", () => {
	test("loopback", () => expect(isIP("127.0.0.1")).toBe(true));
	test("all zeros", () => expect(isIP("0.0.0.0")).toBe(true));
	test("max values", () => expect(isIP("255.255.255.255")).toBe(true));
});

describe("isIP — invalid IPv4", () => {
	test("octet out of range", () => expect(isIP("256.0.0.0")).toBe(false));
	test("too few octets", () => expect(isIP("1.2.3")).toBe(false));
});

describe("isIP — valid IPv6", () => {
	test("loopback", () => expect(isIP("::1")).toBe(true));
	test("full form", () =>
		expect(isIP("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true));
});

describe("isIP — invalid IPv6", () => {
	test("too many groups", () =>
		expect(isIP("2001:db8:85a3:0:0:8a2e:370:7334:1234")).toBe(false));
});

describe("isIP — version filter", () => {
	test("v4 passes version 4", () => expect(isIP("127.0.0.1", 4)).toBe(true));
	test("v4 fails version 6", () => expect(isIP("127.0.0.1", 6)).toBe(false));
	test("v6 passes version 6", () => expect(isIP("::1", 6)).toBe(true));
	test("v6 fails version 4", () => expect(isIP("::1", 4)).toBe(false));
});
