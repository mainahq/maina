import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveState } from "../../../wiki/state";
import type { WikiState } from "../../../wiki/types";
import { runWikiLint, wikiLintToFindings } from "../wiki-lint";

// ─── Setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let wikiDir: string;
let repoRoot: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-lint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	repoRoot = tmpDir;
	wikiDir = join(tmpDir, ".maina", "wiki");
	mkdirSync(wikiDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function writeArticle(relPath: string, content: string): void {
	const fullPath = join(wikiDir, relPath);
	const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content, "utf-8");
}

function writeSourceFile(relPath: string, content: string): void {
	const fullPath = join(repoRoot, relPath);
	const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content, "utf-8");
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Wiki Lint Tool", () => {
	describe("graceful skip", () => {
		it("should return empty result when wiki dir does not exist", () => {
			const result = runWikiLint({
				wikiDir: join(tmpDir, "nonexistent", "wiki"),
				repoRoot,
			});

			expect(result.stale).toHaveLength(0);
			expect(result.orphans).toHaveLength(0);
			expect(result.gaps).toHaveLength(0);
			expect(result.brokenLinks).toHaveLength(0);
			expect(result.coveragePercent).toBe(0);
		});

		it("should return empty result with zero coverage for empty wiki dir", () => {
			const result = runWikiLint({ wikiDir, repoRoot });

			// Empty wiki dir: no articles at all → info-level "missing" finding
			expect(result.gaps.length).toBeGreaterThanOrEqual(1);
			expect(result.gaps[0]?.severity).toBe("info");
			expect(result.coveragePercent).toBe(0);
		});
	});

	describe("stale detection", () => {
		it("should detect stale source files with mismatched hashes", () => {
			// Write a source file
			writeSourceFile("src/auth.ts", "export function login() {}");

			// Create state with an outdated hash
			const state: WikiState = {
				fileHashes: { "src/auth.ts": "old_hash_that_does_not_match" },
				articleHashes: {},
				lastFullCompile: "2026-04-01T00:00:00.000Z",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};
			saveState(wikiDir, state);

			// Write at least one article so the "missing" check doesn't dominate
			writeArticle(
				"modules/auth.md",
				"# Auth Module\n\nHandles authentication.",
			);

			const result = runWikiLint({ wikiDir, repoRoot });

			// Should find stale source file
			const staleFindings = result.stale;
			expect(staleFindings.length).toBeGreaterThanOrEqual(1);
			expect(staleFindings[0]?.severity).toBe("warning");
			expect(staleFindings[0]?.check).toBe("stale");
			expect(staleFindings[0]?.message).toContain("src/auth.ts");
		});

		it("should not flag files with matching hashes", () => {
			writeSourceFile("src/ok.ts", "export const x = 1;");

			// Compute correct hash from the file
			const { hashContent } = require("../../../wiki/state");
			const correctHash = hashContent("export const x = 1;");

			const state: WikiState = {
				fileHashes: { "src/ok.ts": correctHash },
				articleHashes: {},
				lastFullCompile: "2026-04-01T00:00:00.000Z",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};
			saveState(wikiDir, state);

			const result = runWikiLint({ wikiDir, repoRoot });

			const staleSourceFindings = result.stale.filter((f) =>
				f.message.includes("src/ok.ts"),
			);
			expect(staleSourceFindings).toHaveLength(0);
		});
	});

	describe("broken link detection", () => {
		it("should detect broken [[entity:nonexistent]] links", () => {
			writeArticle(
				"modules/auth.md",
				"# Auth Module\n\nReferences [[entity:nonexistent]] and [[module:missing]].",
			);

			const result = runWikiLint({ wikiDir, repoRoot });

			expect(result.brokenLinks.length).toBe(2);
			expect(result.brokenLinks[0]?.severity).toBe("error");
			expect(result.brokenLinks[0]?.check).toBe("broken_link");
			expect(result.brokenLinks[0]?.message).toContain("entity:nonexistent");
		});

		it("should not flag valid links to existing articles", () => {
			writeArticle("modules/auth.md", "# Auth Module\n\nSee [[entity:user]].");
			writeArticle("entities/user.md", "# User Entity\n\nThe user model.");

			const result = runWikiLint({ wikiDir, repoRoot });

			expect(result.brokenLinks).toHaveLength(0);
		});

		it("should detect multiple broken links across articles", () => {
			writeArticle("modules/auth.md", "# Auth\n\n[[entity:ghost]]");
			writeArticle("modules/db.md", "# DB\n\n[[decision:phantom]]");

			const result = runWikiLint({ wikiDir, repoRoot });

			expect(result.brokenLinks.length).toBe(2);
		});
	});

	describe("coverage calculation", () => {
		it("should report 0% coverage when no state exists", () => {
			writeArticle("modules/auth.md", "# Auth Module");

			const result = runWikiLint({ wikiDir, repoRoot });

			expect(result.coveragePercent).toBe(0);
		});

		it("should calculate correct coverage percentage", () => {
			const state: WikiState = {
				fileHashes: {
					"src/a.ts": "h1",
					"src/b.ts": "h2",
					"src/c.ts": "h3",
					"src/d.ts": "h4",
				},
				articleHashes: {
					"modules/a.md": "ah1",
					"modules/b.md": "ah2",
				},
				lastFullCompile: "2026-04-01T00:00:00.000Z",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};
			saveState(wikiDir, state);

			// Write enough articles to avoid the "missing" check
			for (let i = 0; i < 5; i++) {
				writeArticle(`modules/m${i}.md`, `# Module ${i}`);
			}

			const result = runWikiLint({ wikiDir, repoRoot });

			// 2 articles / 4 source files = 50%
			expect(result.coveragePercent).toBe(50);
		});
	});

	describe("missing articles", () => {
		it("should warn when wiki has fewer than 5 articles", () => {
			writeArticle("modules/auth.md", "# Auth Module");
			writeArticle("modules/db.md", "# DB Module");

			const result = runWikiLint({ wikiDir, repoRoot });

			const missingFindings = result.gaps.filter((f) =>
				f.message.includes("article(s)"),
			);
			expect(missingFindings.length).toBe(1);
			expect(missingFindings[0]?.severity).toBe("info");
		});

		it("should not warn when wiki has 5+ articles", () => {
			for (let i = 0; i < 6; i++) {
				writeArticle(`modules/mod${i}.md`, `# Module ${i}`);
			}

			const result = runWikiLint({ wikiDir, repoRoot });

			const missingFindings = result.gaps.filter((f) =>
				f.message.includes("article(s)"),
			);
			expect(missingFindings).toHaveLength(0);
		});
	});

	describe("wikiLintToFindings conversion", () => {
		it("should convert WikiLintResult to Finding[]", () => {
			writeArticle("modules/auth.md", "# Auth\n\n[[entity:broken]]");

			const result = runWikiLint({ wikiDir, repoRoot });
			const findings = wikiLintToFindings(result);

			expect(findings.length).toBeGreaterThan(0);
			for (const finding of findings) {
				expect(finding.tool).toBe("wiki-lint");
				expect(finding.severity).toBeDefined();
				expect(finding.message).toBeTruthy();
				expect(finding.ruleId).toMatch(/^wiki\//);
			}
		});

		it("should map broken link to error severity", () => {
			writeArticle("modules/auth.md", "# Auth\n\n[[entity:missing-ref]]");

			const result = runWikiLint({ wikiDir, repoRoot });
			const findings = wikiLintToFindings(result);

			const brokenLinkFindings = findings.filter(
				(f) => f.ruleId === "wiki/broken_link",
			);
			expect(brokenLinkFindings.length).toBe(1);
			expect(brokenLinkFindings[0]?.severity).toBe("error");
		});

		it("should return empty findings for empty result", () => {
			const result = runWikiLint({
				wikiDir: join(tmpDir, "nonexistent"),
				repoRoot,
			});
			const findings = wikiLintToFindings(result);
			expect(findings).toHaveLength(0);
		});
	});
});
