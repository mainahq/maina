import { describe, expect, test } from "bun:test";
import {
	extractManaged,
	MAINA_REGION_END,
	MAINA_REGION_START,
	mergeManaged,
	wrapManaged,
} from "../region";

describe("region", () => {
	test("wrapManaged surrounds content with delimiters", () => {
		const wrapped = wrapManaged("hello world");
		expect(wrapped).toContain(MAINA_REGION_START);
		expect(wrapped).toContain(MAINA_REGION_END);
		expect(wrapped).toContain("hello world");
		// Start delimiter comes before end delimiter
		expect(wrapped.indexOf(MAINA_REGION_START)).toBeLessThan(
			wrapped.indexOf(MAINA_REGION_END),
		);
	});

	test("mergeManaged appends region to existing file without region", () => {
		const existing = "# My file\n\nUser content here.\n";
		const managed = "managed body";
		const merged = mergeManaged(existing, managed);
		expect(merged).toContain("User content here.");
		expect(merged).toContain(MAINA_REGION_START);
		expect(merged).toContain("managed body");
		expect(merged).toContain(MAINA_REGION_END);
		// User content preserved first
		expect(merged.indexOf("User content here.")).toBeLessThan(
			merged.indexOf(MAINA_REGION_START),
		);
	});

	test("mergeManaged replaces existing region in place", () => {
		const existing = [
			"# File",
			"",
			"user stuff above",
			"",
			MAINA_REGION_START,
			"OLD MANAGED CONTENT",
			MAINA_REGION_END,
			"",
			"user stuff below",
		].join("\n");
		const merged = mergeManaged(existing, "NEW MANAGED CONTENT");
		expect(merged).toContain("user stuff above");
		expect(merged).toContain("user stuff below");
		expect(merged).toContain("NEW MANAGED CONTENT");
		expect(merged).not.toContain("OLD MANAGED CONTENT");
		// Only one region
		expect(merged.split(MAINA_REGION_START).length).toBe(2);
	});

	test("mergeManaged is idempotent when rerun with same content", () => {
		const existing = "# Hello\n\nuser content\n";
		const managed = "managed body";
		const once = mergeManaged(existing, managed);
		const twice = mergeManaged(once, managed);
		expect(twice).toBe(once);
	});

	test("extractManaged returns managed content when region present", () => {
		const existing = [
			"prefix",
			MAINA_REGION_START,
			"line 1",
			"line 2",
			MAINA_REGION_END,
			"suffix",
		].join("\n");
		const managed = extractManaged(existing);
		expect(managed).not.toBeNull();
		expect(managed).toContain("line 1");
		expect(managed).toContain("line 2");
		expect(managed).not.toContain("prefix");
		expect(managed).not.toContain("suffix");
	});

	test("extractManaged returns null if no region", () => {
		expect(extractManaged("no region here")).toBeNull();
	});
});
