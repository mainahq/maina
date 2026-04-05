/**
 * Tests for built-in type checking in the verify pipeline.
 *
 * Verifies that runTypecheck() spawns the correct language-specific
 * type checker and parses its output into Finding[].
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runTypecheck", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `maina-typecheck-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("should parse tsc --noEmit output into Finding[]", async () => {
		// Create a tsconfig.json and install typescript locally
		writeFileSync(
			join(testDir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { strict: true, noEmit: true },
				include: ["*.ts"],
			}),
		);
		// Install typescript locally so tsc is in node_modules/.bin
		const install = Bun.spawnSync(["bun", "add", "typescript"], {
			cwd: testDir,
		});
		if (install.exitCode !== 0) {
			// Skip if we can't install (CI without network, etc.)
			return;
		}

		// Create a file with a type error
		writeFileSync(
			join(testDir, "bad.ts"),
			'const x: number = "not a number";\n',
		);

		const { runTypecheck } = await import("../typecheck");
		const result = await runTypecheck(["bad.ts"], testDir);

		expect(result.findings.length).toBeGreaterThan(0);
		const first = result.findings[0];
		if (!first) throw new Error("Expected at least one finding");
		expect(first.tool).toBe("tsc");
		expect(first.severity).toBe("error");
		expect(first.file).toContain("bad.ts");
		expect(first.line).toBeGreaterThan(0);
		expect(result.duration).toBeGreaterThanOrEqual(0);
	});

	it("should return empty findings for clean file", async () => {
		writeFileSync(
			join(testDir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { strict: true, noEmit: true },
				include: ["*.ts"],
			}),
		);
		Bun.spawnSync(["bun", "add", "typescript"], { cwd: testDir });

		writeFileSync(join(testDir, "good.ts"), "const x: number = 42;\n");

		const { runTypecheck } = await import("../typecheck");
		const result = await runTypecheck(["good.ts"], testDir);

		expect(result.findings).toEqual([]);
		expect(result.tool).toBe("tsc");
	});

	it("should skip with info when tsc is not found", async () => {
		// Use a non-existent tool path
		const { runTypecheck } = await import("../typecheck");
		const result = await runTypecheck(["file.ts"], testDir, {
			command: "nonexistent-tsc-binary",
		});

		expect(result.findings).toEqual([]);
		expect(result.skipped).toBe(true);
	});

	it("should detect language and use appropriate checker", async () => {
		const { getTypecheckCommand } = await import("../typecheck");

		expect(getTypecheckCommand("typescript")).toEqual(
			expect.objectContaining({ tool: "tsc" }),
		);
		expect(getTypecheckCommand("python")).toEqual(
			expect.objectContaining({ tool: "mypy" }),
		);
		expect(getTypecheckCommand("go")).toEqual(
			expect.objectContaining({ tool: "go-vet" }),
		);
		expect(getTypecheckCommand("rust")).toEqual(
			expect.objectContaining({ tool: "cargo-check" }),
		);
		expect(getTypecheckCommand("csharp")).toEqual(
			expect.objectContaining({ tool: "dotnet-build" }),
		);
		expect(getTypecheckCommand("java")).toEqual(
			expect.objectContaining({ tool: "javac" }),
		);
	});

	it("should parse multiple errors from tsc output", async () => {
		const { parseTscOutput } = await import("../typecheck");

		const tscOutput = [
			"src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
			"src/bar.ts(3,1): error TS2304: Cannot find name 'x'.",
		].join("\n");

		const findings = parseTscOutput(tscOutput);

		expect(findings).toHaveLength(2);
		expect(findings[0]).toEqual({
			tool: "tsc",
			file: "src/foo.ts",
			line: 10,
			column: 5,
			message: "TS2322: Type 'string' is not assignable to type 'number'.",
			severity: "error",
			ruleId: "TS2322",
		});
		expect(findings[1]).toEqual({
			tool: "tsc",
			file: "src/bar.ts",
			line: 3,
			column: 1,
			message: "TS2304: Cannot find name 'x'.",
			severity: "error",
			ruleId: "TS2304",
		});
	});

	it("should return empty for empty tsc output", async () => {
		const { parseTscOutput } = await import("../typecheck");
		const findings = parseTscOutput("");
		expect(findings).toEqual([]);
	});

	it("should handle no tsconfig.json gracefully", async () => {
		// No tsconfig.json in testDir
		const { runTypecheck } = await import("../typecheck");
		const result = await runTypecheck(["file.ts"], testDir);

		// Should not crash, should skip or return empty
		expect(result.skipped).toBe(true);
	});
});
