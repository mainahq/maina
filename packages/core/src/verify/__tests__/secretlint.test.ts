import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import { parseSecretlintOutput, runSecretlint } from "../secretlint";

// ─── parseSecretlintOutput ─────────────────────────────────────────────────

describe("parseSecretlintOutput", () => {
	it("should return empty array for empty output", () => {
		const findings = parseSecretlintOutput("");
		expect(findings).toEqual([]);
	});

	it("should parse a single secret finding", () => {
		const output = JSON.stringify([
			{
				filePath: "src/config.ts",
				messages: [
					{
						ruleId: "@secretlint/secretlint-rule-preset-recommend",
						message: "Found AWS Access Key ID",
						range: [10, 30],
						loc: {
							start: { line: 5, column: 10 },
							end: { line: 5, column: 30 },
						},
						severity: 2,
					},
				],
			},
		]);

		const findings = parseSecretlintOutput(output);
		expect(findings.length).toBe(1);
		expect(findings[0]?.tool).toBe("secretlint");
		expect(findings[0]?.file).toBe("src/config.ts");
		expect(findings[0]?.line).toBe(5);
		expect(findings[0]?.column).toBe(10);
		expect(findings[0]?.message).toBe("Found AWS Access Key ID");
		expect(findings[0]?.severity).toBe("error");
		expect(findings[0]?.ruleId).toBe(
			"@secretlint/secretlint-rule-preset-recommend",
		);
	});

	it("should map severity levels correctly", () => {
		const makeOutput = (severity: number) =>
			JSON.stringify([
				{
					filePath: "file.ts",
					messages: [
						{
							ruleId: "rule",
							message: "msg",
							loc: {
								start: { line: 1, column: 0 },
								end: { line: 1, column: 10 },
							},
							severity,
						},
					],
				},
			]);

		// severity 2 = error, 1 = warning, 0 = info
		expect(parseSecretlintOutput(makeOutput(2))[0]?.severity).toBe("error");
		expect(parseSecretlintOutput(makeOutput(1))[0]?.severity).toBe("warning");
		expect(parseSecretlintOutput(makeOutput(0))[0]?.severity).toBe("info");
	});

	it("should handle multiple files with multiple messages", () => {
		const output = JSON.stringify([
			{
				filePath: "a.ts",
				messages: [
					{
						ruleId: "rule-a",
						message: "Secret A",
						loc: {
							start: { line: 1, column: 0 },
							end: { line: 1, column: 10 },
						},
						severity: 2,
					},
					{
						ruleId: "rule-b",
						message: "Secret B",
						loc: {
							start: { line: 5, column: 3 },
							end: { line: 5, column: 20 },
						},
						severity: 1,
					},
				],
			},
			{
				filePath: "b.ts",
				messages: [
					{
						ruleId: "rule-c",
						message: "Secret C",
						loc: {
							start: { line: 10, column: 0 },
							end: { line: 10, column: 30 },
						},
						severity: 2,
					},
				],
			},
		]);

		const findings = parseSecretlintOutput(output);
		expect(findings.length).toBe(3);
		expect(findings[0]?.file).toBe("a.ts");
		expect(findings[1]?.file).toBe("a.ts");
		expect(findings[2]?.file).toBe("b.ts");
	});

	it("should handle files with empty messages array", () => {
		const output = JSON.stringify([
			{
				filePath: "clean.ts",
				messages: [],
			},
		]);
		const findings = parseSecretlintOutput(output);
		expect(findings).toEqual([]);
	});

	it("should return empty array for invalid JSON", () => {
		const findings = parseSecretlintOutput("not valid json {{{");
		expect(findings).toEqual([]);
	});

	it("should return empty array for malformed structure", () => {
		const findings = parseSecretlintOutput(
			JSON.stringify({ unexpected: true }),
		);
		expect(findings).toEqual([]);
	});

	it("should handle messages with missing loc gracefully", () => {
		const output = JSON.stringify([
			{
				filePath: "file.ts",
				messages: [
					{
						ruleId: "rule-x",
						message: "No loc info",
						severity: 2,
					},
				],
			},
		]);
		const findings = parseSecretlintOutput(output);
		expect(findings.length).toBe(1);
		expect(findings[0]?.line).toBe(0);
		expect(findings[0]?.column).toBeUndefined();
	});
});

// ─── runSecretlint ─────────────────────────────────────────────────────────

const FINDINGS = JSON.stringify([
	{
		filePath: "src/app.ts",
		messages: [
			{
				ruleId: "fake-secret",
				message: "fake secretlint finding",
				loc: { start: { line: 2, column: 1 } },
				severity: 2,
			},
		],
	},
]);

describe("runSecretlint", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-544-secretlint-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const scripted = () =>
		createFakeProcess({
			"secretlint --format json src/app.ts": { stdout: FINDINGS },
		});

	it("should skip without spawning when secretlint is not installed", async () => {
		const proc = scripted();
		const result = await runSecretlint({
			cwd: root,
			available: false,
			process: proc,
		});
		expect(result).toEqual({ findings: [], skipped: true });
		expect(proc.calls()).toEqual([]);
	});

	it("should skip quietly without spawning when the root has no secretlint config (#544)", async () => {
		// secretlint refuses to run without one; spawning it only produced a
		// stack trace as a notice on every verify.
		const proc = scripted();
		const result = await runSecretlint({
			cwd: root,
			files: ["src/app.ts"],
			available: true,
			process: proc,
		});
		expect(result).toEqual({ findings: [], skipped: true });
		expect(proc.calls()).toEqual([]);
	});

	for (const config of [
		".secretlintrc",
		".secretlintrc.json",
		".secretlintrc.yaml",
		".secretlintrc.yml",
		".secretlintrc.js",
		".secretlintrc.cjs",
	]) {
		it(`should run when the root has ${config}`, async () => {
			writeFileSync(join(root, config), "{}");
			const proc = scripted();
			const result = await runSecretlint({
				cwd: root,
				files: ["src/app.ts"],
				available: true,
				process: proc,
			});
			expect(result.skipped).toBe(false);
			expect(result.findings).toHaveLength(1);
			expect(proc.calls()).toHaveLength(1);
		});
	}

	it("should run when package.json carries a secretlint config", async () => {
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ secretlint: { rules: [] } }),
		);
		const result = await runSecretlint({
			cwd: root,
			files: ["src/app.ts"],
			available: true,
			process: scripted(),
		});
		expect(result.skipped).toBe(false);
		expect(result.findings).toHaveLength(1);
	});

	it("should not count a package.json without a secretlint field as config", async () => {
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
		const proc = scripted();
		const result = await runSecretlint({
			cwd: root,
			files: ["src/app.ts"],
			available: true,
			process: proc,
		});
		expect(result).toEqual({ findings: [], skipped: true });
		expect(proc.calls()).toEqual([]);
	});
});
