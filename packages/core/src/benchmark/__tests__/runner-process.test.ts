/** Issue #433: the benchmark runner spawns `bun test` through a `ProcessPort`. */

import { describe, expect, test } from "bun:test";
import { createFakeProcess } from "../../ports/testing";
import { runBenchmark } from "../runner";

describe("runBenchmark over an injected ProcessPort", () => {
	test("runs the test files in implDir with MITT_IMPL_PATH and parses the counts", async () => {
		const proc = createFakeProcess({
			"bun test a.test.ts": { stdout: " 4 pass\n", stderr: " 1 fail\n" },
		});
		const result = await runBenchmark({
			pipeline: "maina",
			storyName: "story",
			testFiles: ["a.test.ts"],
			implDir: "/impl",
			env: { PATH: "/bin" },
			process: proc,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.testsPassed).toBe(4);
		expect(result.value.testsFailed).toBe(1);
		const [call] = proc.calls();
		expect(call?.options.cwd).toBe("/impl");
		expect(call?.options.env).toEqual({
			PATH: "/bin",
			MITT_IMPL_PATH: "/impl",
		});
	});

	test("a spawn failure is an error result", async () => {
		const result = await runBenchmark({
			pipeline: "maina",
			storyName: "story",
			testFiles: ["a.test.ts"],
			implDir: "/impl",
			env: {},
			process: createFakeProcess(),
		});
		expect(result.ok).toBe(false);
	});
});
