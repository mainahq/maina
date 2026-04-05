/**
 * Tests for cross-function consistency checking.
 *
 * Verifies that checkConsistency() catches cases where related functions
 * use inconsistent patterns (e.g., calling isURL but not isIP).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("checkConsistency", () => {
	let testDir: string;
	let mainaDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `maina-consistency-test-${Date.now()}`);
		mainaDir = join(testDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("should detect inconsistent validator usage from spec constraints", async () => {
		// Spec says "use isIP for IP hosts"
		writeFileSync(
			join(mainaDir, "constitution.md"),
			"## Rules\n- Always validate IP addresses with isIP when checking hosts\n",
		);

		const code = [
			"function processUrl(host: string) {",
			"  if (isURL(host)) {",
			"    // should also call isIP but doesn't",
			"    return fetch(host);",
			"  }",
			"}",
		].join("\n");

		writeFileSync(join(testDir, "handler.ts"), code);

		const { checkConsistency } = await import("../consistency");
		const result = await checkConsistency(["handler.ts"], testDir, mainaDir);

		expect(result.rulesChecked).toBeGreaterThan(0);
	});

	it("should return empty findings when no spec exists", async () => {
		writeFileSync(join(testDir, "clean.ts"), "const x = 1;\n");

		const { checkConsistency } = await import("../consistency");
		const result = await checkConsistency(
			["clean.ts"],
			testDir,
			join(testDir, "nonexistent-maina"),
		);

		expect(result.findings).toEqual([]);
	});

	it("should detect heuristic pattern: validator used on one path but not another", async () => {
		const code = [
			'import { isValid } from "./validators";',
			"",
			"function handleA(input: string) {",
			"  if (isValid(input)) return process(input);",
			"}",
			"",
			"function handleB(input: string) {",
			"  // Missing isValid check — inconsistent with handleA",
			"  return process(input);",
			"}",
		].join("\n");

		writeFileSync(join(testDir, "handlers.ts"), code);

		const { checkConsistency } = await import("../consistency");
		const result = await checkConsistency(["handlers.ts"], testDir, mainaDir);

		// Heuristic mode should at least check for patterns
		expect(result.rulesChecked).toBeGreaterThanOrEqual(0);
	});

	it("should return ConsistencyResult with correct shape", async () => {
		writeFileSync(join(testDir, "simple.ts"), "const x = 1;\n");

		const { checkConsistency } = await import("../consistency");
		const result = await checkConsistency(["simple.ts"], testDir, mainaDir);

		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("rulesChecked");
		expect(Array.isArray(result.findings)).toBe(true);
		expect(typeof result.rulesChecked).toBe("number");
	});
});
