import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectAsyncStyle,
	detectErrorHandling,
	detectFunctionStyle,
	detectImportStyle,
	sampleFiles,
	samplePatterns,
} from "../pattern-sampler";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`pattern-sampler-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── sampleFiles ─────────────────────────────────────────────────────────

describe("sampleFiles", () => {
	test("collects .ts files sorted alphabetically", () => {
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "b.ts"), "");
		writeFileSync(join(tmpDir, "src", "a.ts"), "");
		writeFileSync(join(tmpDir, "src", "c.ts"), "");

		const files = sampleFiles(tmpDir);
		expect(files).toHaveLength(3);
		expect(files[0]).toContain("a.ts");
	});

	test("skips node_modules and __tests__", () => {
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, "node_modules", "pkg"), { recursive: true });
		mkdirSync(join(tmpDir, "src", "__tests__"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "index.ts"), "");
		writeFileSync(join(tmpDir, "node_modules", "pkg", "index.ts"), "");
		writeFileSync(join(tmpDir, "src", "__tests__", "test.ts"), "");

		const files = sampleFiles(tmpDir);
		expect(files).toHaveLength(1);
	});

	test("skips .test.ts and .d.ts files", () => {
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "index.ts"), "");
		writeFileSync(join(tmpDir, "src", "index.test.ts"), "");
		writeFileSync(join(tmpDir, "src", "types.d.ts"), "");

		const files = sampleFiles(tmpDir);
		expect(files).toHaveLength(1);
	});

	test("caps at maxFiles", () => {
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		for (let i = 0; i < 10; i++) {
			writeFileSync(join(tmpDir, "src", `file${i}.ts`), "");
		}

		const files = sampleFiles(tmpDir, 5);
		expect(files).toHaveLength(5);
	});

	test("returns empty for directory with no TS files", () => {
		expect(sampleFiles(tmpDir)).toEqual([]);
	});
});

// ── detectAsyncStyle ────────────────────────────────────────────────────

describe("detectAsyncStyle", () => {
	test("detects async/await preference", () => {
		const contents = [
			"const x = await fetch(); const y = await db.query(); const z = await api.get(); await save(); await load(); await init();",
		];
		const rule = detectAsyncStyle(contents);
		expect(rule).not.toBeNull();
		expect(rule?.text).toContain("async/await");
	});

	test("detects .then preference", () => {
		const contents = [
			"fetch().then(r => r).then(d => d).then(x => x).then(y => y).then(z => z).then(a => a);",
		];
		const rule = detectAsyncStyle(contents);
		expect(rule).not.toBeNull();
		expect(rule?.text).toContain(".then()");
	});

	test("returns null for too few samples", () => {
		const contents = ["const x = await fetch();"];
		expect(detectAsyncStyle(contents)).toBeNull();
	});

	test("returns null for mixed usage", () => {
		const contents = [
			"await fetch(); await get(); await post(); foo.then(x => x); bar.then(y => y); baz.then(z => z);",
		];
		expect(detectAsyncStyle(contents)).toBeNull();
	});
});

// ── detectFunctionStyle ─────────────────────────────────────────────────

describe("detectFunctionStyle", () => {
	test("detects arrow function preference", () => {
		const contents = Array(15).fill(
			"const fn = (x: number) => x; const fn2 = async (y: string) => y;",
		);
		const rule = detectFunctionStyle(contents);
		expect(rule).not.toBeNull();
		expect(rule?.text).toContain("arrow");
	});

	test("detects function declaration preference", () => {
		const contents = Array(15).fill(
			"function doStuff() {} function doMore() {}",
		);
		const rule = detectFunctionStyle(contents);
		expect(rule).not.toBeNull();
		expect(rule?.text).toContain("declaration");
	});
});

// ── detectImportStyle ───────────────────────────────────────────────────

describe("detectImportStyle", () => {
	test("detects named import preference", () => {
		const contents = Array(10).fill(
			'import { join } from "path"; import { readFileSync } from "fs";',
		);
		const rule = detectImportStyle(contents);
		expect(rule).not.toBeNull();
		expect(rule?.text).toContain("named");
	});

	test("detects default import preference", () => {
		const contents = Array(10).fill(
			'import express from "express"; import React from "react";',
		);
		const rule = detectImportStyle(contents);
		expect(rule).not.toBeNull();
		expect(rule?.text).toContain("default");
	});
});

// ── detectErrorHandling ─────────────────────────────────────────────────

describe("detectErrorHandling", () => {
	test("detects try/catch preference", () => {
		const contents = [
			"try { x() } catch {} try { y() } catch {} try { z() } catch {} try { a() } catch {} try { b() } catch {}",
		];
		const rule = detectErrorHandling(contents);
		expect(rule).not.toBeNull();
		expect(rule?.text).toContain("try/catch");
	});
});

// ── samplePatterns (combined) ───────────────────────────────────────────

describe("samplePatterns", () => {
	test("runs on maina repo and returns rules", () => {
		const rules = samplePatterns(process.cwd());
		// Maina uses async/await + named imports heavily
		expect(rules.length).toBeGreaterThanOrEqual(1);
		for (const rule of rules) {
			expect(rule.confidence).toBeGreaterThanOrEqual(0.4);
			expect(rule.confidence).toBeLessThanOrEqual(0.7);
			expect(rule.source).toContain("pattern-sampler");
		}
	});

	test("returns empty for directory with no TS files", () => {
		expect(samplePatterns(tmpDir)).toEqual([]);
	});

	test("output is deterministic", () => {
		const run1 = samplePatterns(process.cwd());
		const run2 = samplePatterns(process.cwd());
		expect(run1).toEqual(run2);
	});
});
