/**
 * Issue #434: suites that still spawn real tools (tsc, biome, go vet, git,
 * every registered tool's version probe) exceeded bun's 5s default timeout
 * under CI or parallel local load. Each keeps its real-tool smoke tests but
 * must declare an explicit, generous suite timeout; everything else in them
 * runs over the `ProcessPort` fake.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");

/** Minimum explicit suite timeout for a real-tool suite, in milliseconds. */
const MIN_REAL_TOOL_TIMEOUT_MS = 30_000;

/** Test files (relative to packages/core/src) that spawn real tools. */
const REAL_TOOL_SUITES = [
	"verify/__tests__/typecheck.test.ts",
	"verify/__tests__/detect.test.ts",
	"verify/__tests__/syntax-guard.test.ts",
	"context/__tests__/engine.test.ts",
] as const;

/** The value passed to `setDefaultTimeout(...)`, or null when absent. */
function suiteTimeout(source: string): number | null {
	const match = source.match(/setDefaultTimeout\(\s*([\d_]+)\s*\)/);
	return match?.[1] ? Number(match[1].replaceAll("_", "")) : null;
}

describe("real-tool suites declare an explicit timeout", () => {
	for (const suite of REAL_TOOL_SUITES) {
		test(suite, () => {
			const timeout = suiteTimeout(readFileSync(join(SRC, suite), "utf-8"));
			expect(timeout).not.toBeNull();
			expect(timeout ?? 0).toBeGreaterThanOrEqual(MIN_REAL_TOOL_TIMEOUT_MS);
		});
	}
});
