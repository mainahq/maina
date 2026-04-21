/**
 * confirmRules — TTY y/n/e + non-TTY auto-accept ≥ 0.6.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rule } from "../adopt";
import { confirmRules } from "../confirm";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const SAMPLE_RULES: Rule[] = [
	{
		text: "Use conventional commits.",
		source: "AGENTS.md:L10",
		sourceKind: "AGENTS.md",
		confidence: 1.0,
		category: "commits",
	},
	{
		text: "Ship tree-sitter guesses only when confirmed.",
		source: "tree-sitter:ts",
		sourceKind: "tree-sitter",
		confidence: 0.4,
		category: "style",
	},
	{
		text: "Run biome check --write before commit.",
		source: "biome.json",
		sourceKind: "biome.json",
		confidence: 0.9,
		category: "ci",
	},
	{
		text: "A low-confidence guess.",
		source: "tree-sitter:ts",
		sourceKind: "tree-sitter",
		confidence: 0.3,
		category: "style",
	},
];

describe("confirmRules — non-TTY path", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("auto-accepts rules with confidence ≥ 0.6 by default", async () => {
		const result = await confirmRules(SAMPLE_RULES, {
			interactive: false,
			mainaDir: join(tmpDir, ".maina"),
		});
		const acceptedTexts = result.accepted.map((r) => r.text);
		expect(acceptedTexts).toContain("Use conventional commits.");
		expect(acceptedTexts).toContain("Run biome check --write before commit.");
		expect(acceptedTexts).not.toContain(
			"Ship tree-sitter guesses only when confirmed.",
		);
		expect(acceptedTexts).not.toContain("A low-confidence guess.");
	});

	test("rejected rules land in .maina/rejected.yml", async () => {
		const mainaDir = join(tmpDir, ".maina");
		await confirmRules(SAMPLE_RULES, {
			interactive: false,
			mainaDir,
		});
		const path = join(mainaDir, "rejected.yml");
		expect(existsSync(path)).toBe(true);
		const text = readFileSync(path, "utf-8");
		expect(text).toContain("A low-confidence guess.");
		expect(text).toContain("Ship tree-sitter guesses only when confirmed.");
		// Conventional-commits is ACCEPTED, must not leak into rejected file.
		expect(text.includes("Use conventional commits.")).toBe(false);
	});

	test("custom autoAcceptThreshold changes which rules are kept", async () => {
		const result = await confirmRules(SAMPLE_RULES, {
			interactive: false,
			autoAcceptThreshold: 0.9,
			mainaDir: join(tmpDir, ".maina"),
		});
		// Only the biome rule (0.9) and AGENTS rule (1.0) clear.
		expect(result.accepted.length).toBe(2);
	});

	test("re-running is append-safe — same rejected rule is not duplicated", async () => {
		const mainaDir = join(tmpDir, ".maina");
		await confirmRules(SAMPLE_RULES, { interactive: false, mainaDir });
		await confirmRules(SAMPLE_RULES, { interactive: false, mainaDir });
		const text = readFileSync(join(mainaDir, "rejected.yml"), "utf-8");
		const matches = text.match(/A low-confidence guess\./g) ?? [];
		expect(matches.length).toBe(1);
	});

	test("empty input → empty output, no file written", async () => {
		const mainaDir = join(tmpDir, ".maina");
		const result = await confirmRules([], {
			interactive: false,
			mainaDir,
		});
		expect(result.accepted).toEqual([]);
		expect(result.rejected).toEqual([]);
		// File should not be created for empty input.
		expect(existsSync(join(mainaDir, "rejected.yml"))).toBe(false);
	});
});
