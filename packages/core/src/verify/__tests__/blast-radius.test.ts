/**
 * Blast-radius-aware checks (v1 task 6.3, FR-VER-5): for types and tests,
 * verify covers what a change can break, not just its changed lines.
 *
 * The graph is the query fixture's call chain, `app -> top -> mid -> base`
 * (base lives in `src/core.ts`), with one test per link except `top`.
 */

import { describe, expect, test } from "bun:test";
import { indexedRepo, unwrap } from "../../graph/query/__tests__/fixture";
import { createFakeProcess } from "../../ports/testing";
import {
	type BlastRadius,
	computeBlastRadius,
	typecheckScope,
} from "../blast-radius";
import { type Finding, filterByDiffWithMap } from "../diff-filter";
import { runAffectedTests, selectAffectedTests } from "../tools/tests";

const tsc = (file: string, line: number, code: string): Finding => ({
	tool: "tsc",
	file,
	line,
	column: 1,
	message: `${code}: message`,
	severity: "error",
	ruleId: code,
});

/** `base(n)` became `base(n, step)`: only line 1 of `src/core.ts` changed. */
const SIGNATURE_CHANGE = new Map([["src/core.ts", new Set([1])]]);

async function radiusOf(files: readonly string[]): Promise<BlastRadius> {
	const repo = await indexedRepo();
	return unwrap(computeBlastRadius(repo.ports, files));
}

describe("types: a signature change surfaces errors in its callers", () => {
	test("a caller's type error outside the diff is shown, not hidden as pre-existing", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		// mid() calls base() on line 4 of an unchanged file.
		const callerError = tsc("src/mid.ts", 4, "TS2554");

		const without = filterByDiffWithMap([callerError], SIGNATURE_CHANGE);
		expect(without.shown).toEqual([]);

		const withRadius = filterByDiffWithMap(
			[callerError],
			SIGNATURE_CHANGE,
			new Set(),
			radius,
		);
		expect(withRadius.shown).toEqual([callerError]);
		expect(withRadius.hidden).toBe(0);
	});

	test("transitive callers in range count too", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		const inTop = tsc("src/top.ts", 5, "TS2345");
		const { shown } = filterByDiffWithMap(
			[inTop],
			SIGNATURE_CHANGE,
			new Set(),
			radius,
		);
		expect(shown).toEqual([inTop]);
	});

	test("a broken import of the changed file is shown in its dependent", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		// `import { base } from "./core"` after base was renamed.
		const importError = tsc("src/mid.ts", 1, "TS2305");
		const { shown } = filterByDiffWithMap(
			[importError],
			SIGNATURE_CHANGE,
			new Set(),
			radius,
		);
		expect(shown).toEqual([importError]);
	});

	test("errors outside the blast radius stay hidden", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		const unrelated = tsc("src/other.ts", 3, "TS2322");
		// Inside a dependent, but not in a caller and not an import error.
		const elsewhere = tsc("src/mid.ts", 2, "TS2322");
		const { shown, hidden } = filterByDiffWithMap(
			[unrelated, elsewhere],
			SIGNATURE_CHANGE,
			new Set(),
			radius,
		);
		expect(shown).toEqual([]);
		expect(hidden).toBe(2);
	});

	test("only type and test checks widen: other tools stay diff-only", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		const slop: Finding = {
			tool: "slop",
			file: "src/mid.ts",
			line: 4,
			message: "console.log",
			severity: "warning",
		};
		const { shown } = filterByDiffWithMap(
			[slop],
			SIGNATURE_CHANGE,
			new Set(),
			radius,
		);
		expect(shown).toEqual([]);
	});

	test("the type checker also runs on the dependents' files", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		expect(typecheckScope(["src/core.ts"], radius)).toEqual([
			"src/core.ts",
			"src/app.ts",
			"src/mid.ts",
			"src/top.ts",
		]);
		expect(typecheckScope(["src/core.ts"], undefined)).toEqual(["src/core.ts"]);
	});

	test("files the graph does not know have an empty radius", async () => {
		const radius = await radiusOf(["src/new-file.ts"]);
		expect(radius.callers).toEqual([]);
		expect(radius.dependents).toEqual([]);
		expect(radius.tests).toEqual([]);
	});
});

describe("tests: affected tests are selected from the graph", () => {
	test("a change selects the tests of the target and every caller in range", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		expect(selectAffectedTests(["src/core.ts"], radius)).toEqual([
			"src/app.test.ts",
			"src/core.test.ts",
			"src/mid.test.ts",
		]);
	});

	test("a change to a leaf selects only its own tests", async () => {
		const radius = await radiusOf(["src/app.ts"]);
		expect(selectAffectedTests(["src/app.ts"], radius)).toEqual([
			"src/app.test.ts",
		]);
	});

	test("code nothing reaches selects no tests", async () => {
		const radius = await radiusOf(["src/other.ts"]);
		expect(selectAffectedTests(["src/other.ts"], radius)).toEqual([]);
	});

	test("a changed test file is always selected, graph or not", () => {
		expect(
			selectAffectedTests(["src/mid.test.ts", "README.md"], undefined),
		).toEqual(["src/mid.test.ts"]);
	});

	test("runs exactly the selected tests and reports a failure against its file", async () => {
		const fake = createFakeProcess(() => ({
			ok: true,
			value: {
				exitCode: 1,
				stdout: "",
				stderr: [
					"src/core.test.ts:",
					"(pass) base > adds one [0.10ms]",
					"",
					"src/mid.test.ts:",
					"(fail) mid > doubles [0.21ms]",
					"",
					" 1 pass",
					" 1 fail",
				].join("\n"),
			},
		}));
		const result = await runAffectedTests(
			["src/core.test.ts", "src/mid.test.ts"],
			"/repo",
			{ process: fake, runner: ["bun", "test"] },
		);
		expect(fake.calls().map((c) => c.argv)).toEqual([
			["bun", "test", "./src/core.test.ts", "./src/mid.test.ts"],
		]);
		expect(fake.calls()[0]?.options.cwd).toBe("/repo");
		expect(result.skipped).toBe(false);
		expect(result.findings).toEqual([
			{
				tool: "tests",
				file: "src/mid.test.ts",
				line: 1,
				message: "Affected test failed: mid > doubles",
				severity: "error",
			},
		]);
	});

	test("passing tests produce no findings", async () => {
		const fake = createFakeProcess({
			"bun test ./src/core.test.ts": { exitCode: 0 },
		});
		const result = await runAffectedTests(["src/core.test.ts"], "/repo", {
			process: fake,
			runner: ["bun", "test"],
		});
		expect(result).toEqual({ findings: [], skipped: false });
	});

	test("with no affected tests nothing runs", async () => {
		const fake = createFakeProcess();
		const result = await runAffectedTests([], "/repo", {
			process: fake,
			runner: ["bun", "test"],
		});
		expect(fake.calls()).toEqual([]);
		expect(result.skipped).toBe(true);
	});

	test("a test failure in the radius survives the diff filter", async () => {
		const radius = await radiusOf(["src/core.ts"]);
		const failure: Finding = {
			tool: "tests",
			file: "src/app.test.ts",
			line: 1,
			message: "Affected test failed: app > runs",
			severity: "error",
		};
		const { shown } = filterByDiffWithMap(
			[failure],
			SIGNATURE_CHANGE,
			new Set(),
			radius,
		);
		expect(shown).toEqual([failure]);
	});

	test("Bun's end-of-run recap neither repeats a failure nor moves it to the last file", async () => {
		// Outside an agent shell Bun reprints every failure after the last
		// file's header; those lines are not new failures in that file.
		const fake = createFakeProcess(() => ({
			ok: true,
			value: {
				exitCode: 1,
				stdout: "",
				stderr: [
					"src/mid.test.ts:",
					"(fail) mid > doubles [0.21ms]",
					"",
					"src/core.test.ts:",
					"(pass) base > adds one [0.10ms]",
					"",
					"1 tests failed:",
					"(fail) mid > doubles [0.21ms]",
					"",
					" 1 pass",
					" 1 fail",
				].join("\n"),
			},
		}));
		const result = await runAffectedTests(
			["src/core.test.ts", "src/mid.test.ts"],
			"/repo",
			{ process: fake, runner: ["bun", "test"] },
		);
		expect(result.findings).toEqual([
			{
				tool: "tests",
				file: "src/mid.test.ts",
				line: 1,
				message: "Affected test failed: mid > doubles",
				severity: "error",
			},
		]);
	});

	test("a failing changed test file survives the diff filter, graph or not", async () => {
		// The file changed (so it was selected) but not on line 1, and the
		// graph does not list it as covering anything.
		const failure: Finding = {
			tool: "tests",
			file: "src/new-case.test.ts",
			line: 1,
			message: "Affected test failed: new case",
			severity: "error",
		};
		const changed = new Map([["src/new-case.test.ts", new Set([12])]]);
		const radius = await radiusOf(["src/new-case.test.ts"]);

		expect(filterByDiffWithMap([failure], changed).shown).toEqual([failure]);
		expect(
			filterByDiffWithMap([failure], changed, new Set(), radius).shown,
		).toEqual([failure]);
	});
});
