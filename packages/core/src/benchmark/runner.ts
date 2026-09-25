import type { Result } from "../db/index";
import type { ProcessPort } from "../ports/process";
import { systemProcess } from "../process/index";
import type { BenchmarkMetrics } from "./types";

interface TestResult {
	passed: number;
	failed: number;
	total: number;
}

interface RunBenchmarkOptions {
	pipeline: "maina" | "speckit";
	storyName: string;
	testFiles: string[];
	implDir: string;
	tokensInput?: number;
	tokensOutput?: number;
	verifyFindings?: number;
	specQualityScore?: number;
	implLOC?: number;
	attemptsToPass?: number;
	bugsIntroduced?: number;
	toolsUsed?: string[];
	/**
	 * Environment for the `bun test` child (it also gets `MITT_IMPL_PATH`).
	 * The edge passes its process environment; core never reads it.
	 */
	env: Readonly<Record<string, string | undefined>>;
	/** Spawns `bun test`; the system adapter by default. */
	process?: ProcessPort;
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

	const processPort = options.process ?? systemProcess;
	const run = await processPort.spawn(["bun", "test", ...options.testFiles], {
		cwd: options.implDir,
		env: { ...options.env, MITT_IMPL_PATH: options.implDir },
	});
	if (!run.ok) {
		const reason =
			run.error.kind === "timeout"
				? `timed out after ${run.error.timeoutMs}ms`
				: run.error.message;
		return { ok: false, error: `Benchmark run failed: ${reason}` };
	}

	const { stdout, stderr } = run.value;
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
			implLOC: options.implLOC ?? 0,
			attemptsToPass: options.attemptsToPass ?? 1,
			bugsIntroduced: options.bugsIntroduced ?? 0,
			toolsUsed: options.toolsUsed ?? [],
		},
	};
}
