/**
 * Training tests for isURL validator.
 * These are given to the AI during implementation — straightforward cases only.
 */
import { describe, expect, test } from "bun:test";

const implPath = process.env.VALIDATOR_IMPL_PATH ?? "../validator";
const mod = await import(implPath);
const { isURL } = mod;

describe("isURL — valid", () => {
	test("simple http", () => expect(isURL("http://foo.com")).toBe(true));
	test("https with path and query", () =>
		expect(isURL("https://bar.co.uk/path?q=1")).toBe(true));
	test("with port", () => expect(isURL("http://example.com:8080")).toBe(true));
	test("localhost", () => expect(isURL("http://localhost")).toBe(true));
	test("ftp", () => expect(isURL("ftp://files.example.com")).toBe(true));
});

describe("isURL — invalid basics", () => {
	test("empty string", () => expect(isURL("")).toBe(false));
	test("spaces", () => expect(isURL("http://foo .com")).toBe(false));
	test("no host", () => expect(isURL("http://")).toBe(false));
	test("port too large", () =>
		expect(isURL("http://example.com:99999")).toBe(false));
	test("missing protocol", () => expect(isURL("example.com")).toBe(false));
});

describe("isURL — IP host", () => {
	test("IPv4 host", () => expect(isURL("http://192.168.1.1")).toBe(true));
});
