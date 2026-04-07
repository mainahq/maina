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

		it("should include new check types in findings conversion", () => {
			// Set up spec drift scenario
			const featuresDir = join(tmpDir, ".maina", "features");
			const featureDir = join(featuresDir, "001-auth");
			mkdirSync(featureDir, { recursive: true });

			writeFileSync(
				join(featureDir, "spec.md"),
				"# Feature: Auth\n\n## Acceptance Criteria\n\n- [ ] Must use Result<T,E> pattern\n",
			);
			writeFileSync(
				join(featureDir, "plan.md"),
				"# Implementation Plan: Auth\n",
			);

			// Create source file with throw
			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "auth.ts"),
				'export function login() { throw new Error("fail"); }\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				featuresDir,
			});
			const findings = wikiLintToFindings(result);

			const specDriftFindings = findings.filter(
				(f) => f.ruleId === "wiki/spec_drift",
			);
			expect(specDriftFindings.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ─── Check 6: Spec Drift ────────────────────────────────────────────

	describe("spec drift detection", () => {
		it("should detect throw in code when spec says Result pattern", () => {
			const featuresDir = join(tmpDir, ".maina", "features");
			const featureDir = join(featuresDir, "001-auth");
			mkdirSync(featureDir, { recursive: true });

			writeFileSync(
				join(featureDir, "spec.md"),
				"# Feature: Auth\n\n## Acceptance Criteria\n\n- [ ] All errors use Result<T,E> pattern\n",
			);
			writeFileSync(
				join(featureDir, "plan.md"),
				"# Implementation Plan: Auth\n",
			);

			// Create source file with throw
			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "auth.ts"),
				'export function login() {\n  throw new Error("failed");\n}\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				featuresDir,
			});

			expect(result.specDrift.length).toBeGreaterThanOrEqual(1);
			expect(result.specDrift[0]?.check).toBe("spec_drift");
			expect(result.specDrift[0]?.severity).toBe("warning");
			expect(result.specDrift[0]?.message).toContain("Result/never-throw");
			expect(result.specDrift[0]?.message).toContain("throw");
		});

		it("should detect throw when spec says never throw", () => {
			const featuresDir = join(tmpDir, ".maina", "features");
			const featureDir = join(featuresDir, "002-errors");
			mkdirSync(featureDir, { recursive: true });

			writeFileSync(
				join(featureDir, "spec.md"),
				"# Feature: Errors\n\n## Acceptance Criteria\n\n- [ ] Functions must never throw exceptions\n",
			);
			writeFileSync(
				join(featureDir, "plan.md"),
				"# Implementation Plan: Errors\n",
			);

			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "handler.ts"),
				'export function handle() {\n  throw "oops";\n}\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				featuresDir,
			});

			expect(result.specDrift.length).toBeGreaterThanOrEqual(1);
			expect(result.specDrift[0]?.message).toContain("never-throw");
		});

		it("should not flag when code uses Result correctly (no throw)", () => {
			const featuresDir = join(tmpDir, ".maina", "features");
			const featureDir = join(featuresDir, "001-auth");
			mkdirSync(featureDir, { recursive: true });

			writeFileSync(
				join(featureDir, "spec.md"),
				"# Feature: Auth\n\n## Acceptance Criteria\n\n- [ ] All errors use Result<T,E> pattern\n",
			);
			writeFileSync(
				join(featureDir, "plan.md"),
				"# Implementation Plan: Auth\n",
			);

			// Create source file that uses Result correctly
			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "auth.ts"),
				'export function login(): Result<User, string> {\n  return { ok: true, value: { name: "test" } };\n}\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				featuresDir,
			});

			expect(result.specDrift).toHaveLength(0);
		});

		it("should skip comments containing throw", () => {
			const featuresDir = join(tmpDir, ".maina", "features");
			const featureDir = join(featuresDir, "001-auth");
			mkdirSync(featureDir, { recursive: true });

			writeFileSync(
				join(featureDir, "spec.md"),
				"# Feature: Auth\n\n## Acceptance Criteria\n\n- [ ] Must use Result<T,E> pattern\n",
			);
			writeFileSync(
				join(featureDir, "plan.md"),
				"# Implementation Plan: Auth\n",
			);

			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "auth.ts"),
				"// We never throw here, we use Result\nexport function login() { return { ok: true, value: null }; }\n",
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				featuresDir,
			});

			expect(result.specDrift).toHaveLength(0);
		});

		it("should handle missing features dir gracefully", () => {
			const result = runWikiLint({
				wikiDir,
				repoRoot,
				featuresDir: join(tmpDir, "nonexistent", "features"),
			});

			expect(result.specDrift).toHaveLength(0);
		});
	});

	// ─── Check 7: Decision Violations ───────────────────────────────────

	describe("decision violation detection", () => {
		it("should detect jest import when ADR says bun:test", () => {
			const adrDir = join(tmpDir, "adr");
			mkdirSync(adrDir, { recursive: true });

			writeFileSync(
				join(adrDir, "0001-testing.md"),
				"# ADR-0001: Use Bun Test\n\n## Status\n\nAccepted\n\n## Context\n\nWe need a test runner.\n\n## Decision\n\nWe will use bun:test for all tests.\n",
			);

			// Create source file with jest import
			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "auth.test.ts"),
				'import { describe, it } from "jest";\n\ndescribe("auth", () => {});\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir,
			});

			expect(result.decisionViolations.length).toBeGreaterThanOrEqual(1);
			expect(result.decisionViolations[0]?.check).toBe("decision_violation");
			expect(result.decisionViolations[0]?.severity).toBe("error");
			expect(result.decisionViolations[0]?.message).toContain("bun:test");
			expect(result.decisionViolations[0]?.message).toContain("jest");
		});

		it("should detect vitest import when ADR says bun:test", () => {
			const adrDir = join(tmpDir, "adr");
			mkdirSync(adrDir, { recursive: true });

			writeFileSync(
				join(adrDir, "0001-testing.md"),
				"# ADR-0001: Use Bun Test\n\n## Status\n\nAccepted\n\n## Context\n\nNeed tests.\n\n## Decision\n\nUse bun:test exclusively.\n",
			);

			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "utils.test.ts"),
				'import { expect } from "vitest";\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir,
			});

			expect(result.decisionViolations.length).toBeGreaterThanOrEqual(1);
			expect(result.decisionViolations[0]?.message).toContain("vitest");
		});

		it("should detect eslintrc when ADR says Biome", () => {
			const adrDir = join(tmpDir, "adr");
			mkdirSync(adrDir, { recursive: true });

			writeFileSync(
				join(adrDir, "0002-linting.md"),
				"# ADR-0002: Use Biome\n\n## Status\n\nAccepted\n\n## Context\n\nLinting.\n\n## Decision\n\nUse Biome for linting and formatting.\n",
			);

			// Create eslintrc file at repo root
			writeFileSync(join(tmpDir, ".eslintrc.json"), '{ "extends": [] }');

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir,
			});

			expect(result.decisionViolations.length).toBeGreaterThanOrEqual(1);
			const eslintViolation = result.decisionViolations.find((f) =>
				f.message.includes("ESLint"),
			);
			expect(eslintViolation).toBeDefined();
			expect(eslintViolation?.severity).toBe("error");
		});

		it("should not flag compliant code", () => {
			const adrDir = join(tmpDir, "adr");
			mkdirSync(adrDir, { recursive: true });

			writeFileSync(
				join(adrDir, "0001-testing.md"),
				"# ADR-0001: Use Bun Test\n\n## Status\n\nAccepted\n\n## Context\n\nTests.\n\n## Decision\n\nUse bun:test.\n",
			);

			// Source file uses bun:test (compliant)
			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "auth.test.ts"),
				'import { describe, it, expect } from "bun:test";\n\ndescribe("auth", () => { it("works", () => { expect(true).toBe(true); }); });\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir,
			});

			expect(result.decisionViolations).toHaveLength(0);
		});

		it("should ignore non-accepted decisions", () => {
			const adrDir = join(tmpDir, "adr");
			mkdirSync(adrDir, { recursive: true });

			writeFileSync(
				join(adrDir, "0001-testing.md"),
				"# ADR-0001: Use Bun Test\n\n## Status\n\nProposed\n\n## Context\n\nTests.\n\n## Decision\n\nUse bun:test.\n",
			);

			// Jest import — but ADR is only proposed, not accepted
			const srcDir = join(tmpDir, "src");
			mkdirSync(srcDir, { recursive: true });
			writeFileSync(
				join(srcDir, "auth.test.ts"),
				'import { describe } from "jest";\n',
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir,
			});

			expect(result.decisionViolations).toHaveLength(0);
		});

		it("should handle missing adr dir gracefully", () => {
			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir: join(tmpDir, "nonexistent", "adr"),
			});

			expect(result.decisionViolations).toHaveLength(0);
		});
	});

	// ─── Check 8: Missing Rationale ─────────────────────────────────────

	describe("missing rationale detection", () => {
		it("should return empty when no wiki state exists", () => {
			const result = runWikiLint({
				wikiDir,
				repoRoot,
			});

			expect(result.missingRationale).toHaveLength(0);
		});

		it("should not flag files mentioned in an ADR", () => {
			// Create state with tracked file
			const state: WikiState = {
				fileHashes: { "src/auth.ts": "hash1" },
				articleHashes: {},
				lastFullCompile: "2026-04-01T00:00:00.000Z",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};
			saveState(wikiDir, state);

			// Create ADR that mentions the file
			const adrDir = join(tmpDir, "adr");
			mkdirSync(adrDir, { recursive: true });
			writeFileSync(
				join(adrDir, "0001-auth.md"),
				"# ADR-0001: Auth Design\n\n## Status\n\nAccepted\n\n## Context\n\nAuth.\n\n## Decision\n\nUse JWT.\n\n## Entities\n\n- src/auth.ts\n",
			);

			// Enough articles to avoid missing articles check
			for (let i = 0; i < 5; i++) {
				writeArticle(`modules/mod${i}.md`, `# Module ${i}`);
			}

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir,
			});

			// File is mentioned in ADR, so no missing rationale
			const authRationale = result.missingRationale.filter((f) =>
				f.message.includes("src/auth.ts"),
			);
			expect(authRationale).toHaveLength(0);
		});

		it("should handle missing adr dir gracefully for rationale check", () => {
			const state: WikiState = {
				fileHashes: { "src/foo.ts": "hash1" },
				articleHashes: {},
				lastFullCompile: "2026-04-01T00:00:00.000Z",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};
			saveState(wikiDir, state);

			// No adr dir — should still run without errors
			const result = runWikiLint({
				wikiDir,
				repoRoot,
				adrDir: join(tmpDir, "nonexistent", "adr"),
			});

			// Should not throw; findings depend on git commit count (0 in test temp)
			expect(result.missingRationale).toBeDefined();
		});
	});

	// ─── Check 9: Contradiction Detection ───────────────────────────────

	describe("contradiction detection", () => {
		it("should detect entity article pointing to non-existent file", () => {
			writeArticle(
				"entities/user.md",
				"# User Entity\n\n<!-- source: src/models/user.ts:42 -->\n",
			);
			// src/models/user.ts does NOT exist

			const result = runWikiLint({ wikiDir, repoRoot });

			expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
			expect(result.contradictions[0]?.check).toBe("contradiction");
			expect(result.contradictions[0]?.severity).toBe("warning");
			expect(result.contradictions[0]?.message).toContain("no longer exists");
		});

		it("should detect entity article with wrong line number", () => {
			// Create a source file with only 3 lines
			writeSourceFile("src/tiny.ts", "line1\nline2\nline3\n");

			// Entity article says line 100
			writeArticle(
				"entities/tiny.md",
				"# Tiny Entity\n\n<!-- source: src/tiny.ts:100 -->\n",
			);

			const result = runWikiLint({ wikiDir, repoRoot });

			const lineContradictions = result.contradictions.filter((f) =>
				f.message.includes("only has"),
			);
			expect(lineContradictions.length).toBeGreaterThanOrEqual(1);
			expect(lineContradictions[0]?.message).toContain("100");
		});

		it("should not flag entity with valid line reference", () => {
			// Create a source file with 50 lines
			const lines = Array.from(
				{ length: 50 },
				(_, i) => `// line ${i + 1}`,
			).join("\n");
			writeSourceFile("src/big.ts", lines);

			writeArticle(
				"entities/big.md",
				"# Big Entity\n\n<!-- source: src/big.ts:10 -->\n",
			);

			const result = runWikiLint({ wikiDir, repoRoot });

			const lineContradictions = result.contradictions.filter(
				(f) => f.message.includes("only has") && f.message.includes("big.ts"),
			);
			expect(lineContradictions).toHaveLength(0);
		});

		it("should detect module listing non-existent entity", () => {
			writeArticle(
				"modules/auth.md",
				"# Auth Module\n\n<!-- entity: src/auth/handler.ts -->\n<!-- entity: src/auth/gone.ts -->\n",
			);

			// Only handler exists, gone does not
			writeSourceFile("src/auth/handler.ts", "export function handle() {}");

			const result = runWikiLint({ wikiDir, repoRoot });

			const moduleContradictions = result.contradictions.filter((f) =>
				f.message.includes("gone.ts"),
			);
			expect(moduleContradictions.length).toBeGreaterThanOrEqual(1);
			expect(moduleContradictions[0]?.message).toContain("no longer exists");
		});

		it("should detect feature task status mismatch", () => {
			const featuresDir = join(tmpDir, ".maina", "features");
			const featureDir = join(featuresDir, "001-auth");
			mkdirSync(featureDir, { recursive: true });

			// tasks.md says T001 is incomplete
			writeFileSync(
				join(featureDir, "tasks.md"),
				"# Tasks\n\n- [ ] T001: Implement login\n- [x] T002: Add tests\n",
			);
			writeFileSync(
				join(featureDir, "plan.md"),
				"# Implementation Plan: Auth\n",
			);

			// Wiki article says T001 is completed (contradiction)
			writeArticle(
				"features/auth.md",
				"# Auth Feature\n\n<!-- feature: 001-auth -->\n\n- [x] T001: Implement login\n- [x] T002: Add tests\n",
			);

			const result = runWikiLint({
				wikiDir,
				repoRoot,
				featuresDir,
			});

			const taskContradictions = result.contradictions.filter((f) =>
				f.message.includes("T001"),
			);
			expect(taskContradictions.length).toBeGreaterThanOrEqual(1);
			expect(taskContradictions[0]?.message).toContain("completed");
			expect(taskContradictions[0]?.message).toContain("incomplete");
		});

		it("should handle empty wiki gracefully", () => {
			const result = runWikiLint({
				wikiDir: join(tmpDir, "nonexistent-wiki"),
				repoRoot,
			});

			expect(result.contradictions).toHaveLength(0);
		});
	});
});
