/**
 * scanLintConfig — deterministic rule extraction from lint / config files.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLintConfig } from "../scan/lint-config";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-scan-lint-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("scanLintConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("empty repo → empty array", async () => {
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value).toEqual([]);
	});

	test("biome.json with noConsoleLog enabled emits console-log rule", async () => {
		writeFileSync(
			join(tmpDir, "biome.json"),
			JSON.stringify({
				linter: {
					rules: {
						suspicious: { noConsoleLog: "error" },
					},
				},
			}),
		);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const texts = res.value.map((r) => r.text.toLowerCase());
		expect(texts.some((t) => t.includes("console.log"))).toBe(true);
		const rule = res.value.find((r) =>
			r.text.toLowerCase().includes("console.log"),
		);
		expect(rule?.sourceKind).toBe("biome.json");
		expect(rule?.confidence).toBeGreaterThanOrEqual(0.7);
	});

	test("biome.json with noExplicitAny emits any rule", async () => {
		writeFileSync(
			join(tmpDir, "biome.json"),
			JSON.stringify({
				linter: { rules: { suspicious: { noExplicitAny: "error" } } },
			}),
		);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value.some((r) => r.text.toLowerCase().includes("any"))).toBe(
			true,
		);
	});

	test("tsconfig with strict:true emits strict-mode rule", async () => {
		writeFileSync(
			join(tmpDir, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { strict: true } }),
		);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const rule = res.value.find((r) => r.text.toLowerCase().includes("strict"));
		expect(rule).toBeDefined();
		expect(rule?.sourceKind).toBe("tsconfig.json");
	});

	test(".eslintrc.json emits ESLint rule", async () => {
		writeFileSync(
			join(tmpDir, ".eslintrc.json"),
			JSON.stringify({
				rules: { "no-unused-vars": "error" },
			}),
		);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const unusedRule = res.value.find(
			(r) =>
				r.sourceKind === ".eslintrc" && r.text.toLowerCase().includes("unused"),
		);
		expect(unusedRule).toBeDefined();
	});

	test("pyproject.toml [tool.ruff] emits ruff rule", async () => {
		writeFileSync(
			join(tmpDir, "pyproject.toml"),
			`[tool.ruff]
line-length = 100
`,
		);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const rule = res.value.find((r) => r.sourceKind === "pyproject.toml");
		expect(rule).toBeDefined();
		expect(rule?.text.toLowerCase()).toContain("ruff");
	});

	test("Cargo.toml present emits clippy rule", async () => {
		writeFileSync(
			join(tmpDir, "Cargo.toml"),
			`[package]
name = "thing"
version = "0.1.0"
`,
		);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const rule = res.value.find((r) => r.sourceKind === "Cargo.toml");
		expect(rule).toBeDefined();
	});

	test("go.mod present emits go vet rule", async () => {
		writeFileSync(join(tmpDir, "go.mod"), `module example.com/x\n\ngo 1.22\n`);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const rule = res.value.find((r) => r.sourceKind === "go.mod");
		expect(rule).toBeDefined();
		expect(rule?.text.toLowerCase()).toContain("go vet");
	});

	test(".prettierrc emits prettier formatter rule", async () => {
		writeFileSync(join(tmpDir, ".prettierrc"), JSON.stringify({ semi: true }));
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value.some((r) => r.sourceKind === ".prettierrc")).toBe(true);
	});

	test("rules include source line hints or file paths", async () => {
		writeFileSync(
			join(tmpDir, "biome.json"),
			JSON.stringify({
				linter: { rules: { suspicious: { noConsoleLog: "error" } } },
			}),
		);
		const res = await scanLintConfig(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		for (const rule of res.value) {
			expect(rule.source.length).toBeGreaterThan(0);
			expect(rule.confidence).toBeGreaterThan(0);
			expect(rule.confidence).toBeLessThanOrEqual(1);
		}
	});
});
