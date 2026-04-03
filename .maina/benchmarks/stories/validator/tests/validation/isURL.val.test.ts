/**
 * VALIDATION tests for isURL — hidden from AI during implementation.
 * Edge cases, option interactions, and security traps.
 */
import { describe, expect, test } from "bun:test";

const implPath = process.env.VALIDATOR_IMPL_PATH ?? "../validator";
const mod = await import(implPath);
const { isURL } = mod;

// -- Protocol edge cases ------------------------------------------------------

describe("isURL validation — protocol", () => {
	test("protocol case-insensitive", () => {
		expect(isURL("HTTP://example.com")).toBe(true);
	});

	test("invalid protocol rejected", () => {
		expect(isURL("gopher://example.com")).toBe(false);
	});

	test("protocol-relative rejected by default", () => {
		expect(isURL("//example.com")).toBe(false);
	});

	test("protocol-relative accepted when allowed", () => {
		expect(isURL("//example.com", { allow_protocol_relative_urls: true })).toBe(
			true,
		);
	});

	test("custom protocol accepted when listed", () => {
		expect(isURL("custom://example.com", { protocols: ["custom"] })).toBe(true);
	});

	test("http rejected when not in custom protocols", () => {
		expect(isURL("http://example.com", { protocols: ["custom"] })).toBe(false);
	});

	test("protocol not required when disabled", () => {
		expect(isURL("example.com", { require_protocol: false })).toBe(true);
	});
});

// -- Host edge cases ----------------------------------------------------------

describe("isURL validation — host", () => {
	test("IPv6 host in brackets", () => {
		expect(isURL("http://[::1]")).toBe(true);
	});

	test("IPv6 with port", () => {
		expect(isURL("http://[2001:db8::1]:8080/path")).toBe(true);
	});

	test("invalid IPv4 host", () => {
		expect(isURL("http://999.999.999.999")).toBe(false);
	});

	test("underscores rejected by default", () => {
		expect(isURL("http://my_host.com")).toBe(false);
	});

	test("underscores accepted when allowed", () => {
		expect(isURL("http://my_host.com", { allow_underscores: true })).toBe(true);
	});

	test("trailing dot accepted when allowed", () => {
		expect(isURL("http://example.com.", { allow_trailing_dot: true })).toBe(
			true,
		);
	});

	test("trailing dot rejected by default", () => {
		expect(isURL("http://example.com.")).toBe(false);
	});

	test("internationalized domain name", () => {
		expect(isURL("http://\u00FC\u00F1\u00EE\u00E7\u00F8\u00F0\u00E9.com")).toBe(
			true,
		);
	});

	test("auth in URL accepted", () => {
		expect(isURL("http://user:pass@example.com")).toBe(true);
	});
});

// -- Port edge cases ----------------------------------------------------------

describe("isURL validation — port", () => {
	test("port 0 is valid", () => {
		expect(isURL("http://example.com:0")).toBe(true);
	});

	test("port 65535 is valid", () => {
		expect(isURL("http://example.com:65535")).toBe(true);
	});

	test("port 65536 is invalid", () => {
		expect(isURL("http://example.com:65536")).toBe(false);
	});

	test("require_port rejects missing port", () => {
		expect(isURL("http://example.com", { require_port: true })).toBe(false);
	});

	test("non-numeric port", () => {
		expect(isURL("http://example.com:abc")).toBe(false);
	});
});

// -- Fragment and query options -----------------------------------------------

describe("isURL validation — components", () => {
	test("fragment rejected when disallowed", () => {
		expect(
			isURL("http://example.com/path#section", { allow_fragments: false }),
		).toBe(false);
	});

	test("fragment accepted by default", () => {
		expect(isURL("http://example.com/path#section")).toBe(true);
	});

	test("query rejected when disallowed", () => {
		expect(
			isURL("http://example.com?key=val", { allow_query_components: false }),
		).toBe(false);
	});

	test("query accepted by default", () => {
		expect(isURL("http://example.com?key=val")).toBe(true);
	});

	test("full URL with all components", () => {
		expect(
			isURL("http://user:pass@sub.example.com:8080/path/to?query=val&k=v#frag"),
		).toBe(true);
	});
});

// -- Length and security ------------------------------------------------------

describe("isURL validation — length and security", () => {
	test("rejects over 2083 chars by default", () => {
		expect(isURL(`http://example.com/${"a".repeat(2070)}`)).toBe(false);
	});

	test("accepts long URL when length validation disabled", () => {
		expect(
			isURL(`http://example.com/${"a".repeat(2070)}`, {
				validate_length: false,
			}),
		).toBe(true);
	});

	test("non-string input: null", () => {
		expect(isURL(null as unknown as string)).toBe(false);
	});

	test("non-string input: undefined", () => {
		expect(isURL(undefined as unknown as string)).toBe(false);
	});

	test("non-string input: number", () => {
		expect(isURL(42 as unknown as string)).toBe(false);
	});

	test("double slashes in path are valid", () => {
		expect(isURL("http://example.com//path")).toBe(true);
	});

	test("URL-encoded characters in path", () => {
		expect(isURL("http://example.com/path%20with%20spaces")).toBe(true);
	});
});
