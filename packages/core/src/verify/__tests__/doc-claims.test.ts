/**
 * Tests for the doc-claims verify tool.
 *
 * Validates that import/require lines in markdown docs reference symbols
 * that actually exist in the resolved package source. Catches the class of
 * bug where a subagent fabricates plausible-looking exports in a doc draft
 * (the workkit#43 → maina#180 incident).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectDocClaims, extractMarkdownImports } from "../tools/doc-claims";

describe("extractMarkdownImports", () => {
	it("returns nothing for empty markdown", () => {
		expect(extractMarkdownImports("", "doc.md")).toEqual([]);
	});

	it("ignores prose without code blocks", () => {
		const md = "# Title\n\nJust some prose about `Foo.bar()`.\n";
		expect(extractMarkdownImports(md, "doc.md")).toEqual([]);
	});

	it("extracts named imports inside fenced code blocks", () => {
		const md = [
			"# Guide",
			"",
			"```ts",
			'import { Foo, Bar } from "@local/pkg";',
			"```",
			"",
		].join("\n");

		const imports = extractMarkdownImports(md, "doc.md");
		expect(imports.length).toBe(1);
		expect(imports[0]?.module).toBe("@local/pkg");
		expect(imports[0]?.symbols.sort()).toEqual(["Bar", "Foo"]);
		// Line numbers are 1-based and point to the import statement
		expect(imports[0]?.line).toBe(4);
	});

	it("extracts default imports", () => {
		const md = ["```ts", 'import lodash from "lodash";', "```"].join("\n");
		const imports = extractMarkdownImports(md, "doc.md");
		expect(imports[0]?.module).toBe("lodash");
		// Default imports register as "default" — that's the export key consumers
		// must validate against on the source side.
		expect(imports[0]?.symbols).toEqual(["default"]);
	});

	it("extracts dynamic import() / require() forms", () => {
		const md = [
			"```ts",
			'const x = require("./foo");',
			'const y = await import("./bar");',
			"```",
		].join("\n");
		const imports = extractMarkdownImports(md, "doc.md");
		const modules = imports.map((i) => i.module).sort();
		expect(modules).toEqual(["./bar", "./foo"]);
	});
});

describe("detectDocClaims", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`maina-doc-claims-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	function writePackage(
		name: string,
		exportsContent: string,
		dirName?: string,
	): void {
		const pkgDir = join(testDir, "packages", dirName ?? name);
		mkdirSync(join(pkgDir, "src"), { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({ name, main: "src/index.ts" }),
		);
		writeFileSync(join(pkgDir, "src", "index.ts"), exportsContent);
	}

	it("returns no findings for an empty markdown file", async () => {
		writeFileSync(join(testDir, "doc.md"), "");
		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings).toEqual([]);
	});

	it("skips non-markdown files silently", async () => {
		writeFileSync(join(testDir, "code.ts"), 'import { foo } from "missing";');
		const result = await detectDocClaims(["code.ts"], { cwd: testDir });
		expect(result.findings).toEqual([]);
	});

	it("does not flag valid imports against an existing workspace package", async () => {
		writePackage("@local/pkg", "export const realExport = 1;\n");

		const md = [
			"```ts",
			'import { realExport } from "@local/pkg";',
			"```",
			"",
		].join("\n");
		writeFileSync(join(testDir, "doc.md"), md);

		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings).toEqual([]);
	});

	it("flags a fabricated symbol from a workspace package", async () => {
		writePackage("@local/pkg", "export const realExport = 1;\n");

		const md = [
			"```ts",
			'import { fabricated } from "@local/pkg";',
			"```",
			"",
		].join("\n");
		writeFileSync(join(testDir, "doc.md"), md);

		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings.length).toBe(1);
		const finding = result.findings[0];
		expect(finding?.tool).toBe("doc-claims");
		expect(finding?.severity).toBe("warning");
		expect(finding?.ruleId).toBe("doc-claims/missing-export");
		expect(finding?.file).toBe("doc.md");
		// Line points to the `import` line inside the fence (line 2)
		expect(finding?.line).toBe(2);
		expect(finding?.message).toContain("fabricated");
		expect(finding?.message).toContain("@local/pkg");
	});

	it("resolves @workkit/<name> to packages/<name>/src/index.ts", async () => {
		writePackage(
			"@workkit/memory",
			"export class Conversation { get() {} }\nexport function generateKey() {}\n",
			"memory",
		);

		const md = [
			"```ts",
			'import { Conversation, fabricatedHelper } from "@workkit/memory";',
			"```",
		].join("\n");
		writeFileSync(join(testDir, "doc.md"), md);

		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings.length).toBe(1);
		expect(result.findings[0]?.message).toContain("fabricatedHelper");
	});

	it("recognises re-exports (export { x } from ...)", async () => {
		// Inner module
		const pkgDir = join(testDir, "packages", "pkg");
		mkdirSync(join(pkgDir, "src"), { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({ name: "@local/pkg", main: "src/index.ts" }),
		);
		writeFileSync(
			join(pkgDir, "src", "inner.ts"),
			"export const reExportedThing = 1;\n",
		);
		writeFileSync(
			join(pkgDir, "src", "index.ts"),
			'export { reExportedThing } from "./inner";\n',
		);

		const md = [
			"```ts",
			'import { reExportedThing } from "@local/pkg";',
			"```",
		].join("\n");
		writeFileSync(join(testDir, "doc.md"), md);

		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings).toEqual([]);
	});

	it("skips external packages silently when not resolvable", async () => {
		// No @local/anything written — looks like external
		const md = [
			"```ts",
			'import { useState } from "react";',
			'import { debounce } from "lodash";',
			"```",
		].join("\n");
		writeFileSync(join(testDir, "doc.md"), md);

		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings).toEqual([]);
	});

	it("handles fenced blocks without language hints", async () => {
		writePackage("@local/pkg", "export const realExport = 1;\n");
		const md = [
			"```",
			'import { realExport, ghost } from "@local/pkg";',
			"```",
		].join("\n");
		writeFileSync(join(testDir, "doc.md"), md);

		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings.length).toBe(1);
		expect(result.findings[0]?.message).toContain("ghost");
	});

	it("returns empty findings when given no files", async () => {
		const result = await detectDocClaims([], { cwd: testDir });
		expect(result.findings).toEqual([]);
	});

	it("skips files that do not exist (does not throw)", async () => {
		const result = await detectDocClaims(["nonexistent.md"], { cwd: testDir });
		expect(result.findings).toEqual([]);
	});

	it("flags multiple fabricated symbols separately", async () => {
		writePackage("@local/pkg", "export const real = 1;\n");
		const md = [
			"```ts",
			'import { real, ghost1, ghost2 } from "@local/pkg";',
			"```",
		].join("\n");
		writeFileSync(join(testDir, "doc.md"), md);

		const result = await detectDocClaims(["doc.md"], { cwd: testDir });
		expect(result.findings.length).toBe(2);
		const messages = result.findings.map((f) => f.message).join(" ");
		expect(messages).toContain("ghost1");
		expect(messages).toContain("ghost2");
	});

	it("treats .mdx files the same as .md", async () => {
		writePackage("@local/pkg", "export const real = 1;\n");
		const md = ["```ts", 'import { fakeOne } from "@local/pkg";', "```"].join(
			"\n",
		);
		writeFileSync(join(testDir, "guide.mdx"), md);

		const result = await detectDocClaims(["guide.mdx"], { cwd: testDir });
		expect(result.findings.length).toBe(1);
	});
});
