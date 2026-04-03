import type { Result } from "../db/index";
import type { BenchmarkMetrics } from "./types";

export interface TestResult {
	passed: number;
	failed: number;
	total: number;
}

export interface RunBenchmarkOptions {
	pipeline: "maina" | "speckit";
	storyName: string;
	testFiles: string[];
	implDir: string;
	tokensInput?: number;
	tokensOutput?: number;
	verifyFindings?: number;
	specQualityScore?: number;
}

/**
 * Parse bun test stdout to extract pass/fail counts.
 */
export function parseTestOutput(output: string): TestResult {
	const passMatch = output.match(/(\d+)\s+pass/);
	const failMatch = output.match(/(\d+)\s+fail/);

	const passed = passMatch ? Number.parseInt(passMatch[1] as string, 10) : 0;
	const failed = failMatch ? Number.parseInt(failMatch[1] as string, 10) : 0;

	return { passed, failed, total: passed + failed };
}

/**
 * Run benchmark tests against an implementation directory.
 * Spawns `bun test` on the provided test files and captures metrics.
 */
export async function runBenchmark(
	options: RunBenchmarkOptions,
): Promise<Result<BenchmarkMetrics>> {
	const startMs = performance.now();

	try {
		const proc = Bun.spawn(["bun", "test", ...options.testFiles], {
			cwd: options.implDir,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				MITT_IMPL_PATH: options.implDir,
			},
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		await proc.exited;

		const combined = stdout + stderr;
		const testResult = parseTestOutput(combined);
		const wallClockMs = Math.round(performance.now() - startMs);

		return {
			ok: true,
			value: {
				pipeline: options.pipeline,
				storyName: options.storyName,
				wallClockMs,
				tokensInput: options.tokensInput ?? 0,
				tokensOutput: options.tokensOutput ?? 0,
				testsTotal: testResult.total,
				testsPassed: testResult.passed,
				testsFailed: testResult.failed,
				verifyFindings: options.verifyFindings ?? 0,
				specQualityScore: options.specQualityScore ?? 0,
			},
		};
	} catch (e) {
		return {
			ok: false,
			error: `Benchmark run failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}
