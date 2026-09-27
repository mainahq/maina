/**
 * `runner.ts --json`: the machine-readable record of one run of the suite,
 * which the release evidence collector (scripts/release/evidence/escape.ts)
 * reads for spec §9.6.
 */

import { describe, expect, test } from "bun:test";
import { type CaseResult, runRecord } from "../runner";

const result = (id: string, escaped: boolean): CaseResult => ({
	worker: "claude",
	id,
	category: "network-dns",
	title: id,
	mode: "sandboxed",
	escaped,
	exitCode: escaped ? 0 : 1,
});

describe("runRecord", () => {
	test("a sandboxed run: every case not escaped is blocked", () => {
		expect(
			runRecord(
				"sandboxed",
				[result("a", false), result("b", true), result("c", false)],
				"linux",
				"claude",
			),
		).toEqual({
			os: "linux",
			worker: "claude",
			mode: "sandboxed",
			cases: 3,
			blocked: 2,
			escaped: ["b"],
		});
	});

	test("darwin is recorded as macos", () => {
		expect(runRecord("sandboxed", [], "darwin", "claude").os).toBe("macos");
	});
});
