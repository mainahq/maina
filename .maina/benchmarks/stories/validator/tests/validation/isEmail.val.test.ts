/**
 * VALIDATION tests for isEmail — hidden from AI during implementation.
 * These test edge cases, security traps, and option interactions
 * that only a thorough pipeline (verify + review) would catch.
 */
import { describe, expect, test } from "bun:test";

const implPath = process.env.VALIDATOR_IMPL_PATH ?? "../validator";
const mod = await import(implPath);
const { isEmail } = mod;

// -- Boundary conditions the spec mentions but are easy to miss ----------------

describe("isEmail validation — boundaries", () => {
	test("local part exactly 64 chars is valid", () => {
		const local = "a".repeat(64);
		expect(isEmail(`${local}@domain.com`)).toBe(true);
	});

	test("local part 65 chars is invalid", () => {
		const local = "a".repeat(65);
		expect(isEmail(`${local}@domain.com`)).toBe(false);
	});

	test("total address exactly 254 chars is valid", () => {
		// local@domain format, total 254
		const domain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.com`;
		const local = "x".repeat(254 - domain.length - 1); // -1 for @
		const email = `${local}@${domain}`;
		expect(email.length).toBe(254);
		expect(isEmail(email)).toBe(true);
	});

	test("total address 255 chars is invalid", () => {
		const domain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.com`;
		const local = "x".repeat(255 - domain.length - 1);
		const email = `${local}@${domain}`;
		expect(email.length).toBe(255);
		expect(isEmail(email)).toBe(false);
	});

	test("domain label exactly 63 chars is valid", () => {
		expect(isEmail(`user@${"a".repeat(63)}.com`)).toBe(true);
	});

	test("domain label 64 chars is invalid", () => {
		expect(isEmail(`user@${"a".repeat(64)}.com`)).toBe(false);
	});
});

// -- Structural edge cases the training tests don't cover ----------------------

describe("isEmail validation — structural", () => {
	test("consecutive dots in local part", () => {
		expect(isEmail("user..name@domain.com")).toBe(false);
	});

	test("dot at end of local part", () => {
		expect(isEmail("user.@domain.com")).toBe(false);
	});

	test("missing TLD (no dot in domain)", () => {
		expect(isEmail("user@domain")).toBe(false);
	});

	test("single-char TLD is invalid (needs >=2 alpha)", () => {
		expect(isEmail("user@domain.a")).toBe(false);
	});

	test("hyphen at start of domain label", () => {
		expect(isEmail("user@-domain.com")).toBe(false);
	});

	test("hyphen at end of domain label", () => {
		expect(isEmail("user@domain-.com")).toBe(false);
	});

	test("consecutive dots in domain", () => {
		expect(isEmail("user@domain..com")).toBe(false);
	});

	test("whitespace-only string", () => {
		expect(isEmail("   ")).toBe(false);
	});

	test("numeric TLD is invalid", () => {
		expect(isEmail("user@domain.123")).toBe(false);
	});
});

// -- Security-sensitive edge cases --------------------------------------------

describe("isEmail validation — security", () => {
	test("null byte injection", () => {
		expect(isEmail("user\x00@domain.com")).toBe(false);
	});

	test("control characters", () => {
		expect(isEmail("user\x01@domain.com")).toBe(false);
	});

	test("non-string input: null", () => {
		expect(isEmail(null as unknown as string)).toBe(false);
	});

	test("non-string input: undefined", () => {
		expect(isEmail(undefined as unknown as string)).toBe(false);
	});

	test("non-string input: number", () => {
		expect(isEmail(123 as unknown as string)).toBe(false);
	});

	test("non-string input: boolean", () => {
		expect(isEmail(true as unknown as string)).toBe(false);
	});

	test("non-string input: object", () => {
		expect(isEmail({} as unknown as string)).toBe(false);
	});
});

// -- Option interactions that require careful implementation -------------------

describe("isEmail validation — option combos", () => {
	test("require_display_name rejects bare email", () => {
		expect(isEmail("user@domain.com", { require_display_name: true })).toBe(
			false,
		);
	});

	test("require_display_name accepts with name", () => {
		expect(
			isEmail("Name <user@domain.com>", {
				allow_display_name: true,
				require_display_name: true,
			}),
		).toBe(true);
	});

	test("quoted display name", () => {
		expect(
			isEmail('"John Doe" <john@example.com>', {
				allow_display_name: true,
			}),
		).toBe(true);
	});

	test("utf8 rejected when disabled", () => {
		expect(
			isEmail("\u00FCser@domain.com", { allow_utf8_local_part: false }),
		).toBe(false);
	});

	test("IP domain rejected by default", () => {
		expect(isEmail("user@[192.168.1.1]")).toBe(false);
	});

	test("IP domain accepted when enabled", () => {
		expect(isEmail("user@[192.168.1.1]", { allow_ip_domain: true })).toBe(true);
	});

	test("blacklisted char rejects", () => {
		expect(isEmail("user!name@domain.com", { blacklisted_chars: "!" })).toBe(
			false,
		);
	});

	test("host_blacklist rejects matching domain", () => {
		expect(isEmail("user@banned.com", { host_blacklist: ["banned.com"] })).toBe(
			false,
		);
	});

	test("host_blacklist case-insensitive", () => {
		expect(isEmail("user@BANNED.COM", { host_blacklist: ["banned.com"] })).toBe(
			false,
		);
	});

	test("host_whitelist rejects non-listed", () => {
		expect(isEmail("user@other.com", { host_whitelist: ["allowed.com"] })).toBe(
			false,
		);
	});

	test("host_whitelist accepts listed", () => {
		expect(
			isEmail("user@allowed.com", { host_whitelist: ["allowed.com"] }),
		).toBe(true);
	});

	test("gmail domain-specific rejects dots in local", () => {
		expect(
			isEmail("user.name@gmail.com", { domain_specific_validation: true }),
		).toBe(false);
	});

	test("gmail domain-specific applies to googlemail.com too", () => {
		expect(
			isEmail("user.name@googlemail.com", { domain_specific_validation: true }),
		).toBe(false);
	});
});
