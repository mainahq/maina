/**
 * Tests for JSON output helpers and exit code mapping.
 */

import { describe, expect, it } from "bun:test";
import {
	EXIT_CONFIG_ERROR,
	EXIT_FINDINGS,
	EXIT_PASSED,
	EXIT_TOOL_FAILURE,
	exitCodeFromResult,
} from "../json";

describe("exit codes", () => {
	it("should define correct exit code values", () => {
		expect(EXIT_PASSED).toBe(0);
		expect(EXIT_FINDINGS).toBe(1);
		expect(EXIT_TOOL_FAILURE).toBe(2);
		expect(EXIT_CONFIG_ERROR).toBe(3);
	});

	it("should return 0 for passed result", () => {
		expect(exitCodeFromResult({ passed: true })).toBe(0);
	});

	it("should return 1 for failed result", () => {
		expect(exitCodeFromResult({ passed: false })).toBe(1);
	});
});
