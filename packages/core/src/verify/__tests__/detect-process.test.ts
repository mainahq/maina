/**
 * Issue #434: tool detection probes through an injected `ProcessPort`, so
 * the detect suites can assert behaviour without spawning every registered
 * tool's version command for real (which queued past bun's 5s default
 * timeout under parallel load).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import {
	detectTool,
	detectTools,
	isToolAvailable,
	TOOL_REGISTRY,
	type ToolName,
} from "../detect";

describe("tool detection over an injected ProcessPort", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-detect-port-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("a global version probe that exits 0 marks the tool available", async () => {
		const proc = createFakeProcess({
			"biome --version": { stdout: "Version: 2.3.4\n" },
		});

		const result = await detectTool("biome", root, proc);

		expect(result).toEqual({
			name: "biome",
			command: "biome",
			version: "2.3.4",
			available: true,
		});
		expect(proc.calls()).toEqual([
			{ argv: ["biome", "--version"], options: { cwd: root } },
		]);
	});

	test("a multi-word version flag is split into argv", async () => {
		const proc = createFakeProcess({
			"cargo clippy --version": { stdout: "clippy 0.1.80 (abc 2024-07-01)" },
		});

		const result = await detectTool("cargo-clippy", root, proc);

		expect(result.available).toBe(true);
		expect(result.version).toBe("0.1.80");
		expect(proc.calls()[0]?.argv).toEqual(["cargo", "clippy", "--version"]);
	});

	test("falls back to node_modules/.bin when the global probe fails", async () => {
		const binDir = join(root, "node_modules", ".bin");
		mkdirSync(binDir, { recursive: true });
		const localBiome = join(binDir, "biome");
		writeFileSync(localBiome, "");
		const proc = createFakeProcess({
			"biome --version": { exitCode: 127 },
			[`${localBiome} --version`]: { stdout: "Version: 2.0.0" },
		});

		const result = await detectTool("biome", root, proc);

		expect(result).toEqual({
			name: "biome",
			command: localBiome,
			version: "2.0.0",
			available: true,
		});
	});

	test("a probe that cannot spawn reports the tool unavailable", async () => {
		const proc = createFakeProcess();

		const result = await detectTool("semgrep", root, proc);

		expect(result).toEqual({
			name: "semgrep",
			command: "semgrep",
			version: null,
			available: false,
		});
	});

	test("detectTools probes every registered tool through the port", async () => {
		const proc = createFakeProcess({
			"biome --version": { stdout: "1.9.0" },
		});

		const results = await detectTools(root, undefined, proc);

		expect(results.map((t) => t.name)).toEqual(
			Object.keys(TOOL_REGISTRY) as ToolName[],
		);
		expect(results.filter((t) => t.available).map((t) => t.name)).toEqual([
			"biome",
		]);
		for (const tool of results.filter((t) => !t.available)) {
			expect(tool.version).toBeNull();
		}
	});

	test("detectTools with a language filter only probes relevant tools", async () => {
		const proc = createFakeProcess();

		const results = await detectTools(root, ["python"], proc);

		const probed = new Set(proc.calls().map((c) => c.argv[0]));
		expect(results.map((t) => t.name)).toContain("ruff");
		expect(results.map((t) => t.name)).not.toContain("biome");
		expect(probed.has("biome")).toBe(false);
		expect(probed.has("ruff")).toBe(true);
	});

	test("isToolAvailable answers through the port", async () => {
		const proc = createFakeProcess({ "trivy --version": { stdout: "0.50.1" } });

		expect(await isToolAvailable("trivy", root, proc)).toBe(true);
		expect(await isToolAvailable("semgrep", root, proc)).toBe(false);
	});
});
