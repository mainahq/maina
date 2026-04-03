/**
 * Training tests for isEmail validator.
 * These are given to the AI during implementation — straightforward cases only.
 */
import { describe, expect, test } from "bun:test";

const implPath = process.env.VALIDATOR_IMPL_PATH ?? "../validator";
const mod = await import(implPath);
const { isEmail } = mod;

describe("isEmail — valid", () => {
	test("simple address", () => expect(isEmail("foo@bar.com")).toBe(true));
	test("plus tag", () => expect(isEmail("user+tag@domain.com")).toBe(true));
	test("dots in local", () =>
		expect(isEmail("first.last@example.com")).toBe(true));
	test("subdomain", () =>
		expect(isEmail("user@mail.example.co.uk")).toBe(true));
});

describe("isEmail — invalid basics", () => {
	test("empty string", () => expect(isEmail("")).toBe(false));
	test("no @ sign", () => expect(isEmail("plainaddress")).toBe(false));
	test("multiple @ signs", () =>
		expect(isEmail("user@@domain.com")).toBe(false));
	test("dot at start of local", () =>
		expect(isEmail(".user@domain.com")).toBe(false));
});

describe("isEmail — display name", () => {
	test("accepted when allowed", () =>
		expect(
			isEmail("John <john@example.com>", { allow_display_name: true }),
		).toBe(true));
	test("rejected by default", () =>
		expect(isEmail("John <john@example.com>")).toBe(false));
});

describe("isEmail — utf8", () => {
	test("utf8 local allowed by default", () =>
		expect(isEmail("\u00FCser@domain.com")).toBe(true));
});
