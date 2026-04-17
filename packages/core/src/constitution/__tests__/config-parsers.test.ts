import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseAllConfigs,
	parseBiomeConfig,
	parseEditorConfig,
	parseEslintConfig,
	parsePackageJson,
	parseTsConfig,
} from "../config-parsers";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`config-parser-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseBiomeConfig", () => {
	test("extracts linter and formatter settings", () => {
		writeFileSync(
			join(tmpDir, "biome.json"),
			JSON.stringify({
				linter: { rules: { recommended: true } },
				formatter: { indentStyle: "tab", lineWidth: 100 },
			}),
		);

		const rules = parseBiomeConfig(tmpDir);
		expect(rules.length).toBeGreaterThanOrEqual(3);
		expect(rules.some((r) => r.text === "Linter: Biome")).toBe(true);
		expect(rules.some((r) => r.text === "Indent style: tab")).toBe(true);
		expect(rules.some((r) => r.text === "Line width: 100")).toBe(true);
		expect(rules.every((r) => r.confidence === 1.0)).toBe(true);
	});

	test("returns empty for missing biome.json", () => {
		expect(parseBiomeConfig(tmpDir)).toEqual([]);
	});
});

describe("parseEslintConfig", () => {
	test("detects .eslintrc.json", () => {
		writeFileSync(join(tmpDir, ".eslintrc.json"), "{}");
		const rules = parseEslintConfig(tmpDir);
		expect(rules.length).toBe(1);
		expect(rules[0]?.text).toContain("ESLint");
	});

	test("detects eslint.config.mjs (flat config)", () => {
		writeFileSync(join(tmpDir, "eslint.config.mjs"), "export default [];");
		const rules = parseEslintConfig(tmpDir);
		expect(rules.length).toBe(1);
		expect(rules[0]?.source).toBe("eslint.config.mjs");
	});

	test("returns empty for no eslint config", () => {
		expect(parseEslintConfig(tmpDir)).toEqual([]);
	});
});

describe("parseTsConfig", () => {
	test("detects strict mode and target", () => {
		writeFileSync(
			join(tmpDir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { strict: true, target: "ES2022" },
			}),
		);

		const rules = parseTsConfig(tmpDir);
		expect(rules.some((r) => r.text.includes("strict mode"))).toBe(true);
		expect(rules.some((r) => r.text.includes("ES2022"))).toBe(true);
	});

	test("returns empty for missing tsconfig", () => {
		expect(parseTsConfig(tmpDir)).toEqual([]);
	});
});

describe("parseEditorConfig", () => {
	test("extracts indent and charset settings", () => {
		writeFileSync(
			join(tmpDir, ".editorconfig"),
			"[*]\nindent_style = space\nindent_size = 2\ncharset = utf-8\n",
		);

		const rules = parseEditorConfig(tmpDir);
		expect(rules.some((r) => r.text.includes("space"))).toBe(true);
		expect(rules.some((r) => r.text.includes("2"))).toBe(true);
		expect(rules.some((r) => r.text.includes("utf-8"))).toBe(true);
	});
});

describe("parsePackageJson", () => {
	test("extracts type, engines, and scripts", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				type: "module",
				engines: { node: ">=18" },
				scripts: { test: "bun test", lint: "biome check ." },
			}),
		);

		const rules = parsePackageJson(tmpDir);
		expect(rules.some((r) => r.text.includes("ESM"))).toBe(true);
		expect(rules.some((r) => r.text.includes(">=18"))).toBe(true);
		expect(rules.some((r) => r.text.includes("bun test"))).toBe(true);
		expect(rules.some((r) => r.text.includes("biome check"))).toBe(true);
	});
});

describe("parsePrettierConfig", () => {
	test("detects .prettierrc", () => {
		writeFileSync(join(tmpDir, ".prettierrc"), '{"tabWidth": 4}');
		const { parsePrettierConfig } = require("../config-parsers");
		const rules = parsePrettierConfig(tmpDir);
		expect(rules.length).toBe(1);
		expect(rules[0]?.text).toContain("Prettier");
	});
});

describe("parseAllConfigs", () => {
	test("combines all parsers on fixture directory", () => {
		writeFileSync(
			join(tmpDir, "biome.json"),
			JSON.stringify({ linter: { rules: { recommended: true } } }),
		);
		writeFileSync(
			join(tmpDir, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { strict: true } }),
		);
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ type: "module", scripts: { test: "bun test" } }),
		);

		const rules = parseAllConfigs(tmpDir);
		expect(rules.length).toBeGreaterThanOrEqual(3);
		expect(rules.some((r) => r.text.includes("Biome"))).toBe(true);
		expect(rules.some((r) => r.text.includes("strict"))).toBe(true);
		expect(rules.some((r) => r.text.includes("ESM"))).toBe(true);
	});
});
