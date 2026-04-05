/**
 * JSON output helpers for CI integration.
 *
 * Provides consistent JSON formatting and exit code mapping
 * for all maina commands with --json support.
 */

// ─── Exit Codes ──────────────────────────────────────────────────────────

export const EXIT_PASSED = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_TOOL_FAILURE = 2;
export const EXIT_CONFIG_ERROR = 3;

/**
 * Write JSON to stdout and set exit code.
 * Uses process.exitCode (not process.exit) to allow cleanup.
 */
export function outputJson(data: unknown, exitCode = EXIT_PASSED): void {
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
	process.exitCode = exitCode;
}

/**
 * Determine exit code from a result with a `passed` field.
 */
export function exitCodeFromResult(result: { passed: boolean }): number {
	return result.passed ? EXIT_PASSED : EXIT_FINDINGS;
}
