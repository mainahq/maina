/**
 * The JUnit reader behind the e2e and harness evidence: `bun test
 * --reporter=junit` output → one entry per test case with its outcome.
 */

import { describe, expect, test } from "bun:test";
import { parseJunit, tally } from "../junit";
import { junit } from "./fixtures";

describe("parseJunit", () => {
	test("reads every test case with its suite and outcome", () => {
		const xml = junit([
			["real-config matrix", "claude-code × plugin × gui", "passed"],
			["real-config matrix", "cursor × cli-setup × full", "failed"],
			["real-config matrix", "codex × install-sh × minimal", "skipped"],
		]);
		expect(parseJunit(xml)).toEqual({
			ok: true,
			value: [
				{
					suite: "real-config matrix",
					name: "claude-code × plugin × gui",
					status: "passed",
				},
				{
					suite: "real-config matrix",
					name: "cursor × cli-setup × full",
					status: "failed",
				},
				{
					suite: "real-config matrix",
					name: "codex × install-sh × minimal",
					status: "skipped",
				},
			],
		});
	});

	test("decodes XML entities in names", () => {
		const xml = junit([
			["a &amp; b", "x &lt;y&gt; &quot;z&quot; &apos;w&apos;", "passed"],
		]);
		const r = parseJunit(xml);
		expect(r.ok && r.value[0]).toEqual({
			suite: "a & b",
			name: "x <y> \"z\" 'w'",
			status: "passed",
		});
	});

	test("an <error> element is a failure too", () => {
		const xml = junit([["s", "t", "passed"]]).replace(
			'assertions="1" />',
			'assertions="1"><error message="boom" /></testcase>',
		);
		const r = parseJunit(xml);
		expect(r.ok && r.value[0]?.status).toBe("failed");
	});

	test("text that is not a JUnit report is an error", () => {
		expect(parseJunit("bun test v1.3\n 3 pass").ok).toBe(false);
		expect(parseJunit("").ok).toBe(false);
	});
});

describe("tally", () => {
	test("counts passed, failed and skipped cases", () => {
		const r = parseJunit(
			junit([
				["s", "a", "passed"],
				["s", "b", "passed"],
				["s", "c", "failed"],
				["s", "d", "skipped"],
			]),
		);
		if (!r.ok) throw new Error(r.error);
		expect(tally(r.value)).toEqual({ passed: 2, failed: 1, skipped: 1 });
	});
});
