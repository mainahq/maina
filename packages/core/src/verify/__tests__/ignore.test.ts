import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterIgnoredFiles, isIgnored, loadMainaIgnore } from "../ignore";

describe("verify/ignore", () => {
	describe("isIgnored — directory patterns", () => {
		it("ignores files inside dist/", () => {
			expect(isIgnored("dist/index.js")).toBe(true);
			expect(isIgnored("packages/cli/dist/index.js")).toBe(true);
		});

		it("ignores files inside build/, out/, .next/, coverage/", () => {
			expect(isIgnored("build/output.js")).toBe(true);
			expect(isIgnored("out/server.js")).toBe(true);
			expect(isIgnored(".next/static/main.js")).toBe(true);
			expect(isIgnored("coverage/lcov.info")).toBe(true);
		});

		it("ignores node_modules", () => {
			expect(isIgnored("node_modules/foo/index.js")).toBe(true);
		});

		it("ignores Rust target/ and Go vendor/", () => {
			expect(isIgnored("target/debug/foo")).toBe(true);
			expect(isIgnored("vendor/github.com/x/y.go")).toBe(true);
		});

		it("does NOT ignore a directory that merely begins with the same letters", () => {
			expect(isIgnored("distribute/foo.ts")).toBe(false);
			expect(isIgnored("buildings/types.ts")).toBe(false);
			expect(isIgnored("outboard/index.ts")).toBe(false);
		});

		it("does NOT ignore plain src files", () => {
			expect(isIgnored("src/index.ts")).toBe(false);
			expect(isIgnored("packages/core/src/verify/pipeline.ts")).toBe(false);
		});

		it("normalizes backslashes (Windows paths)", () => {
			expect(isIgnored("packages\\cli\\dist\\index.js")).toBe(true);
		});
	});

	describe("isIgnored — bundle/minified suffixes", () => {
		it("ignores *.min.js / *.min.css / *.min.mjs", () => {
			expect(isIgnored("public/app.min.js")).toBe(true);
			expect(isIgnored("public/styles.min.css")).toBe(true);
			expect(isIgnored("public/app.min.mjs")).toBe(true);
		});

		it("ignores *.bundle.js / *-bundle.js / *.chunk.js", () => {
			expect(isIgnored("public/app.bundle.js")).toBe(true);
			expect(isIgnored("static/runtime-bundle.js")).toBe(true);
			expect(isIgnored("static/chunk-1.chunk.js")).toBe(true);
		});

		it("ignores TypeScript declaration files", () => {
			expect(isIgnored("types/foo.d.ts")).toBe(true);
		});

		it("ignores source maps", () => {
			expect(isIgnored("public/app.js.map")).toBe(true);
		});
	});

	describe("filterIgnoredFiles", () => {
		const TMP = join(tmpdir(), `maina-ignore-test-${Date.now()}`);

		beforeEach(() => {
			mkdirSync(TMP, { recursive: true });
		});

		afterEach(() => {
			rmSync(TMP, { recursive: true, force: true });
		});

		it("splits a mixed list into kept/ignored", () => {
			const result = filterIgnoredFiles(
				[
					"src/index.ts",
					"dist/index.js",
					"src/util.ts",
					"node_modules/foo/index.js",
					"README.md",
				],
				TMP,
			);
			expect(result.kept).toEqual(["src/index.ts", "src/util.ts", "README.md"]);
			expect(result.ignored).toEqual([
				"dist/index.js",
				"node_modules/foo/index.js",
			]);
		});

		it("simulates the issue #207 GitHub-Action repo shape", () => {
			// Repo: src/index.ts (hand-written) + dist/index.js (committed ncc bundle)
			const result = filterIgnoredFiles(["src/index.ts", "dist/index.js"], TMP);
			expect(result.kept).toEqual(["src/index.ts"]);
			expect(result.ignored).toEqual(["dist/index.js"]);
		});

		it("respects an extra pattern in .maina/ignore", () => {
			mkdirSync(join(TMP, ".maina"), { recursive: true });
			writeFileSync(
				join(TMP, ".maina", "ignore"),
				"# project-specific\nfixtures/\n*.snap\n",
				"utf-8",
			);
			const result = filterIgnoredFiles(
				[
					"src/index.ts",
					"fixtures/sample.json",
					"src/__tests__/foo.test.ts.snap",
				],
				TMP,
			);
			expect(result.kept).toEqual(["src/index.ts"]);
			expect(result.ignored).toEqual([
				"fixtures/sample.json",
				"src/__tests__/foo.test.ts.snap",
			]);
		});

		it("returns empty lists for empty input", () => {
			const result = filterIgnoredFiles([], TMP);
			expect(result.kept).toEqual([]);
			expect(result.ignored).toEqual([]);
		});
	});

	describe("loadMainaIgnore", () => {
		const TMP = join(tmpdir(), `maina-loadignore-test-${Date.now()}`);

		beforeEach(() => {
			mkdirSync(TMP, { recursive: true });
		});

		afterEach(() => {
			rmSync(TMP, { recursive: true, force: true });
		});

		it("returns empty array when .maina/ignore is missing", () => {
			expect(loadMainaIgnore(TMP)).toEqual([]);
		});

		it("returns non-comment, non-empty trimmed lines", () => {
			mkdirSync(join(TMP, ".maina"), { recursive: true });
			writeFileSync(
				join(TMP, ".maina", "ignore"),
				"# header\nfoo/\n\n  *.snap\n# end\n",
				"utf-8",
			);
			expect(loadMainaIgnore(TMP)).toEqual(["foo/", "*.snap"]);
		});
	});
});
