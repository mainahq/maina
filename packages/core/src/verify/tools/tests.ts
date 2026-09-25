/**
 * Affected tests (v1 task 6.3, FR-VER-5): the tests the code graph says a
 * change can break, selected from its blast radius and run on their own
 * instead of the whole suite.
 *
 * Only Bun's runner is supported so far; a repo without a Bun lockfile or
 * `bunfig.toml` gets a skipped report that says so.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectLang, isTestPath } from "../../graph/parse/languages";
import type { ProcessEnv, ProcessPort } from "../../ports/process";
import type { BlastRadius } from "../blast-radius";
import type { Finding } from "../diff-filter";

/** The `tool` an affected-test failure carries. */
export const AFFECTED_TESTS_TOOL = "tests";

/** Files Bun's runner picks up: `*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*`. */
const BUN_TEST_FILE = /[._](?:test|spec)\.[cm]?[jt]sx?$/;

/** Long enough for a real suite slice; a hung runner must not hang verify. */
const DEFAULT_TIMEOUT_MS = 300_000;

const BUN_MARKERS = ["bun.lock", "bun.lockb", "bunfig.toml"] as const;

/**
 * A changed file that is itself a test. In a JS/TS `__tests__` directory
 * only a file named like a test counts, not a helper or fixture.
 */
function isTestFile(path: string): boolean {
	const lang = detectLang(path);
	if (lang === null || !isTestPath(path, lang)) return false;
	const jsFamily =
		lang === "typescript" || lang === "tsx" || lang === "javascript";
	return !jsFamily || BUN_TEST_FILE.test(path);
}

/**
 * The tests to run for a change to `files`: the graph's covering tests for
 * the change and its callers, plus any changed file that is a test itself.
 * Sorted and de-duplicated. Pure.
 */
export function selectAffectedTests(
	files: readonly string[],
	radius: BlastRadius | undefined,
): readonly string[] {
	const changedTests = files.filter(isTestFile);
	return [...new Set([...(radius?.tests ?? []), ...changedTests])].sort();
}

/** The runner argv for `cwd`, or null when no supported runner is set up. */
function detectRunner(cwd: string): readonly string[] | null {
	return BUN_MARKERS.some((marker) => existsSync(join(cwd, marker)))
		? ["bun", "test"]
		: null;
}

/** Strip Bun's trailing ` [0.21ms]` timing from a test name. */
const testName = (raw: string): string =>
	raw.replace(/\s+\[[\d.]+\s*m?s\]\s*$/, "").trim();

/** Bun's `N tests failed:` line, which opens the recap of the failures. */
const BUN_RECAP = /^\d+ tests? failed:$/;

/**
 * Bun runner output as findings: one error per `(fail)` line, filed against
 * the test file whose `path:` header precedes it (the first selected test
 * when there is none).
 */
function parseBunFailures(output: string, tests: readonly string[]): Finding[] {
	const selected = new Set(tests);
	const fallback = tests[0] ?? "";
	let current = fallback;
	const findings: Finding[] = [];
	for (const line of output.split("\n")) {
		// Bun's end-of-run recap reprints every failure after the last
		// file's header; they are already counted.
		if (BUN_RECAP.test(line)) break;
		const header = line.match(/^(\S.*):$/);
		if (header?.[1] !== undefined && selected.has(header[1])) {
			current = header[1];
			continue;
		}
		const fail = line.match(/^\(fail\)\s+(.+)$/);
		if (fail?.[1] !== undefined) {
			findings.push({
				tool: AFFECTED_TESTS_TOOL,
				file: current,
				line: 1,
				message: `Affected test failed: ${testName(fail[1])}`,
				severity: "error",
			});
		}
	}
	return findings;
}

type AffectedTestsOptions = Readonly<{
	process: ProcessPort;
	/** Environment for the runner; the parent's when omitted. */
	env?: ProcessEnv;
	/** Runner argv the test paths are appended to; detected from `cwd` when omitted. */
	runner?: readonly string[];
	timeoutMs?: number;
}>;

type AffectedTestsResult = {
	findings: Finding[];
	skipped: boolean;
	notice?: string;
};

/**
 * Run exactly `tests` (repo-relative) under `cwd`. Nothing to run, no
 * supported runner, or a runner that cannot start or times out is a
 * skipped report with a notice, never a pass.
 */
export async function runAffectedTests(
	tests: readonly string[],
	cwd: string,
	options: AffectedTestsOptions,
): Promise<AffectedTestsResult> {
	if (tests.length === 0) {
		return {
			findings: [],
			skipped: true,
			notice: "no tests cover the change",
		};
	}
	const runner = options.runner ?? detectRunner(cwd);
	if (runner === null) {
		return {
			findings: [],
			skipped: true,
			notice: "no supported test runner (bun) is set up",
		};
	}
	const runnable = tests.filter((t) => BUN_TEST_FILE.test(t));
	if (runnable.length === 0) {
		return {
			findings: [],
			skipped: true,
			notice: "the affected tests are not ones bun can run",
		};
	}
	// `./` makes Bun take each argument as a path, not a name filter.
	const result = await options.process.spawn(
		[...runner, ...runnable.map((t) => `./${t}`)],
		{
			cwd,
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			...(options.env ? { env: options.env } : {}),
		},
	);
	if (!result.ok) {
		return {
			findings: [],
			skipped: true,
			notice:
				result.error.kind === "timeout"
					? `affected tests timed out after ${result.error.timeoutMs}ms`
					: `could not start the test runner: ${result.error.message}`,
		};
	}
	const { exitCode, stdout, stderr } = result.value;
	if (exitCode === 0) return { findings: [], skipped: false };
	const failures = parseBunFailures(`${stdout}\n${stderr}`, runnable);
	return {
		findings:
			failures.length > 0
				? failures
				: [
						{
							tool: AFFECTED_TESTS_TOOL,
							file: runnable[0] ?? "",
							line: 1,
							message: `Affected tests failed (exit ${exitCode})`,
							severity: "error",
						},
					],
		skipped: false,
	};
}
