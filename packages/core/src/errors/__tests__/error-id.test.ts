import { describe, expect, test } from "bun:test";
import {
	formatErrorForCli,
	formatErrorForMcp,
	generateErrorId,
	generateErrorIdFromString,
} from "../error-id";

describe("generateErrorId", () => {
	test("produces ERR- prefixed ID", () => {
		const id = generateErrorId(new Error("something broke"));
		expect(id).toMatch(/^ERR-[a-z0-9]{6}$/);
	});

	test("is deterministic — same error produces same ID", () => {
		const e1 = new Error("test message");
		const e2 = new Error("test message");
		expect(generateErrorId(e1)).toBe(generateErrorId(e2));
	});

	test("different errors produce different IDs", () => {
		const e1 = new Error("error one");
		const e2 = new Error("error two");
		expect(generateErrorId(e1)).not.toBe(generateErrorId(e2));
	});

	test("excludes ambiguous characters (O, 0, I, l)", () => {
		// Generate many IDs and check none contain ambiguous chars
		for (let i = 0; i < 100; i++) {
			const id = generateErrorId(new Error(`test-${i}`));
			expect(id).not.toMatch(/[O0Il]/);
		}
	});

	test("ID length is 6 chars after prefix", () => {
		const id = generateErrorId(new Error("any error"));
		const suffix = id.replace("ERR-", "");
		expect(suffix.length).toBe(6);
	});
});

describe("generateErrorIdFromString", () => {
	test("works with plain strings", () => {
		const id = generateErrorIdFromString("some error message");
		expect(id).toMatch(/^ERR-[a-z0-9]{6}$/);
	});

	test("is deterministic", () => {
		const id1 = generateErrorIdFromString("same message");
		const id2 = generateErrorIdFromString("same message");
		expect(id1).toBe(id2);
	});
});

describe("formatErrorForCli", () => {
	test("includes error ID and message", () => {
		const output = formatErrorForCli(new Error("file not found"));
		expect(output).toContain("ERR-");
		expect(output).toContain("file not found");
		expect(output).toContain("github.com/mainahq/maina/issues");
	});
});

describe("formatErrorForMcp", () => {
	test("returns error and error_id fields", () => {
		const result = formatErrorForMcp(new Error("timeout"));
		expect(result.error).toBe("timeout");
		expect(result.error_id).toMatch(/^ERR-[a-z0-9]{6}$/);
	});
});
