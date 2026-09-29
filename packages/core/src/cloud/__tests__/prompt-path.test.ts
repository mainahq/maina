/**
 * `promptFileName` / `isPathWithin` (#662): the cloud's `PromptRecord.path`
 * is untrusted input that `maina sync pull` turns into a file under
 * `.maina/prompts/`. Anything that could name a file elsewhere is refused.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isPathWithin, promptFileName } from "../prompt-path";

describe("promptFileName", () => {
	test.each([
		"commit.md",
		"review.md",
		"my-prompt_v2.md",
		"release.notes.md",
	])("accepts the flat markdown file name %p", (path) => {
		expect(promptFileName(path)).toEqual({ ok: true, value: path });
	});

	test.each([
		["POSIX absolute", "/etc/passwd.md"],
		["POSIX absolute root", "/"],
		["parent traversal", "../escape.md"],
		["deep parent traversal", "../../../../home/u/.bashrc.md"],
		["nested traversal", "a/../../escape.md"],
		["bare parent", ".."],
		["bare current", "."],
		["dot-dot inside a name", "x..md"],
		["forward-slash subdirectory", "sub/review.md"],
		["backslash subdirectory", "sub\\review.md"],
		["backslash traversal", "..\\..\\escape.md"],
		["Windows drive absolute", "C:\\Windows\\evil.md"],
		["Windows drive forward-slash", "C:/Windows/evil.md"],
		["Windows drive relative", "C:evil.md"],
		["Windows UNC", "\\\\server\\share\\evil.md"],
		["Windows UNC forward-slash", "//server/share/evil.md"],
		["Windows device namespace", "\\\\?\\C:\\evil.md"],
		["NTFS alternate data stream", "review.md:hidden"],
		["NUL byte", "review.md\u0000.txt"],
		["control character", "rev\niew.md"],
		["DEL character", "rev\u007fiew.md"],
		["not markdown", "authorized_keys"],
		["markdown extension only", ".md"],
		["empty", ""],
		["whitespace padded", " review.md"],
	])("rejects %s (%p)", (_label, path) => {
		const result = promptFileName(path);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("unsafe prompt path");
	});

	test.each<[unknown]>([
		[undefined],
		[null],
		[42],
		[["review.md"]],
		[{ toString: () => "review.md" }],
		[Object.create(null)],
	])("rejects the non-string %p", (path) => {
		expect(promptFileName(path).ok).toBe(false);
	});

	test("error names the offending path, JSON-escaped", () => {
		const result = promptFileName("../x\u0000.md");
		expect(result).toEqual({
			ok: false,
			error: 'unsafe prompt path "../x\\u0000.md"',
		});
	});
});

describe("isPathWithin", () => {
	const dir = join("/repo", ".maina", "prompts");

	test("a file directly inside is within", () => {
		expect(isPathWithin(dir, join(dir, "review.md"))).toBe(true);
	});

	test("a nested file is within", () => {
		expect(isPathWithin("/repo", dir)).toBe(true);
	});

	test("the directory itself is not within", () => {
		expect(isPathWithin(dir, dir)).toBe(false);
	});

	test("a sibling sharing the prefix is not within", () => {
		expect(isPathWithin(dir, `${dir}-evil/review.md`)).toBe(false);
	});

	test("a path that climbs out is not within", () => {
		expect(isPathWithin(dir, join(dir, "..", "..", "escape.md"))).toBe(false);
	});

	test("an unrelated absolute path is not within", () => {
		expect(isPathWithin(dir, "/etc/passwd")).toBe(false);
	});
});
