import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackWikiRefsRead, trackWikiRefsWritten } from "../tracking";

// ─── Test Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;
let mainaDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-tracking-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mainaDir = join(tmpDir, ".maina");
	mkdirSync(mainaDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Wiki Tracking", () => {
	describe("trackWikiRefsRead", () => {
		it("should append read refs to workflow file", () => {
			trackWikiRefsRead(mainaDir, "wiki-query", [
				"wiki/modules/core.md",
				"wiki/entities/compile.md",
			]);

			const workflowFile = join(mainaDir, "workflow", "current.md");
			expect(existsSync(workflowFile)).toBe(true);

			const content = readFileSync(workflowFile, "utf-8");
			expect(content).toContain("Wiki refs for wiki-query:");
			expect(content).toContain(
				"Read: wiki/modules/core.md, wiki/entities/compile.md",
			);
			expect(content).toContain("Written: _none_");
		});

		it("should handle empty articles list", () => {
			trackWikiRefsRead(mainaDir, "compile", []);

			const workflowFile = join(mainaDir, "workflow", "current.md");
			expect(existsSync(workflowFile)).toBe(true);

			const content = readFileSync(workflowFile, "utf-8");
			expect(content).toContain("Read: _none_");
		});
	});

	describe("trackWikiRefsWritten", () => {
		it("should append written refs to workflow file", () => {
			trackWikiRefsWritten(mainaDir, "wiki-compile", [
				"wiki/modules/auth.md",
				"wiki/index.md",
			]);

			const workflowFile = join(mainaDir, "workflow", "current.md");
			expect(existsSync(workflowFile)).toBe(true);

			const content = readFileSync(workflowFile, "utf-8");
			expect(content).toContain("Wiki refs for wiki-compile:");
			expect(content).toContain("Read: _none_");
			expect(content).toContain("Written: wiki/modules/auth.md, wiki/index.md");
		});

		it("should handle empty articles list", () => {
			trackWikiRefsWritten(mainaDir, "compile", []);

			const workflowFile = join(mainaDir, "workflow", "current.md");
			expect(existsSync(workflowFile)).toBe(true);

			const content = readFileSync(workflowFile, "utf-8");
			expect(content).toContain("Written: _none_");
		});
	});

	describe("edge cases", () => {
		it("should handle missing workflow file gracefully", () => {
			// mainaDir exists but workflow/ does not
			expect(() => {
				trackWikiRefsRead(mainaDir, "test-step", ["wiki/test.md"]);
			}).not.toThrow();

			const workflowFile = join(mainaDir, "workflow", "current.md");
			expect(existsSync(workflowFile)).toBe(true);
		});

		it("should append to existing workflow file", () => {
			const workflowDir = join(mainaDir, "workflow");
			mkdirSync(workflowDir, { recursive: true });
			writeFileSync(
				join(workflowDir, "current.md"),
				"# Workflow: test-feature\n",
			);

			trackWikiRefsRead(mainaDir, "step-1", ["wiki/a.md"]);
			trackWikiRefsWritten(mainaDir, "step-2", ["wiki/b.md"]);

			const content = readFileSync(join(workflowDir, "current.md"), "utf-8");
			expect(content).toContain("# Workflow: test-feature");
			expect(content).toContain("Wiki refs for step-1:");
			expect(content).toContain("Wiki refs for step-2:");
		});
	});
});
