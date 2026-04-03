import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseTestOutput, runBenchmark } from "../runner";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("parseTestOutput", () => {
	test("parses bun test output with pass and fail counts", () => {
		const output = `bun test v1.3.8
 15 pass
 3 fail
 42 expect() calls
Ran 18 tests across 1 file. [120.00ms]`;

		const result = parseTestOutput(output);
		expect(result.passed).toBe(15);
		expect(result.failed).toBe(3);
		expect(result.total).toBe(18);
	});

	test("parses output with only passes", () => {
		const output = `bun test v1.3.8
 18 pass
 0 fail
Ran 18 tests across 1 file. [100.00ms]`;

		const result = parseTestOutput(output);
		expect(result.passed).toBe(18);
		expect(result.failed).toBe(0);
		expect(result.total).toBe(18);
	});

	test("returns zeros for unparseable output", () => {
		const result = parseTestOutput("something went wrong");
		expect(result.passed).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.total).toBe(0);
	});
});

describe("runBenchmark", () => {
	test("runs test file in temp dir and returns metrics", async () => {
		// Create a simple passing test
		const testFile = join(tmpDir, "test.ts");
		writeFileSync(
			testFile,
			`import { test, expect } from "bun:test";
test("1+1=2", () => { expect(1+1).toBe(2); });
test("true", () => { expect(true).toBe(true); });
`,
		);

		const result = await runBenchmark({
			pipeline: "maina",
			storyName: "test-story",
			testFiles: [testFile],
			implDir: tmpDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.pipeline).toBe("maina");
			expect(result.value.storyName).toBe("test-story");
			expect(result.value.testsPassed).toBe(2);
			expect(result.value.testsFailed).toBe(0);
			expect(result.value.testsTotal).toBe(2);
			expect(result.value.wallClockMs).toBeGreaterThan(0);
		}
	});

	test("captures failures in metrics", async () => {
		const testFile = join(tmpDir, "fail.ts");
		writeFileSync(
			testFile,
			`import { test, expect } from "bun:test";
test("pass", () => { expect(true).toBe(true); });
test("fail", () => { expect(1).toBe(2); });
`,
		);

		const result = await runBenchmark({
			pipeline: "maina",
			storyName: "fail-story",
			testFiles: [testFile],
			implDir: tmpDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.testsPassed).toBe(1);
			expect(result.value.testsFailed).toBe(1);
			expect(result.value.testsTotal).toBe(2);
		}
	});
});
