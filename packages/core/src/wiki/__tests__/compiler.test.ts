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
import type { CompileOptions } from "../compiler";
import { compile } from "../compiler";

// ─── Test Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;
let repoRoot: string;
let mainaDir: string;
let wikiDir: string;

function makeOptions(overrides?: Partial<CompileOptions>): CompileOptions {
	return {
		repoRoot,
		mainaDir,
		wikiDir,
		full: true,
		dryRun: false,
		...overrides,
	};
}

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-compiler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	repoRoot = join(tmpDir, "repo");
	mainaDir = join(repoRoot, ".maina");
	wikiDir = join(mainaDir, "wiki");

	// Create repo structure
	mkdirSync(join(repoRoot, "src", "auth"), { recursive: true });
	mkdirSync(join(repoRoot, "src", "cache"), { recursive: true });
	mkdirSync(join(mainaDir, "features", "001-auth"), { recursive: true });
	mkdirSync(join(repoRoot, "adr"), { recursive: true });
	mkdirSync(wikiDir, { recursive: true });

	// Write source files
	writeFileSync(
		join(repoRoot, "src", "auth", "jwt.ts"),
		[
			"export function signToken(payload: unknown): string {",
			'  return "token";',
			"}",
			"",
			"export function verifyToken(token: string): boolean {",
			"  return true;",
			"}",
			"",
			"export interface AuthConfig {",
			"  secret: string;",
			"  expiresIn: number;",
			"}",
		].join("\n"),
	);

	writeFileSync(
		join(repoRoot, "src", "cache", "manager.ts"),
		[
			"export class CacheManager {",
			"  get(key: string): unknown { return null; }",
			"  set(key: string, value: unknown): void {}",
			"}",
			"",
			"export function createCache(): CacheManager {",
			"  return new CacheManager();",
			"}",
		].join("\n"),
	);

	// Write feature files
	writeFileSync(
		join(mainaDir, "features", "001-auth", "plan.md"),
		[
			"# Implementation Plan: JWT Authentication",
			"",
			"## Tasks",
			"- [x] T001: Implement signToken",
			"- [ ] T002: Implement verifyToken",
		].join("\n"),
	);

	writeFileSync(
		join(mainaDir, "features", "001-auth", "spec.md"),
		[
			"# Feature: JWT Authentication",
			"",
			"## Scope",
			"Add JWT-based authentication to the API.",
			"",
			"## Acceptance Criteria",
			"- [ ] Tokens expire after 1 hour",
			"- [ ] Tokens contain user ID",
		].join("\n"),
	);

	// Write ADR file
	writeFileSync(
		join(repoRoot, "adr", "0001-use-jwt.md"),
		[
			"# ADR-0001: Use JWT for Authentication",
			"",
			"## Status",
			"Accepted",
			"",
			"## Context",
			"We need stateless authentication for our API.",
			"",
			"## Decision",
			"Use JWT tokens with RS256 signing.",
			"",
			"## Rationale",
			"JWTs are stateless and work well with microservices.",
			"",
			"## Alternatives Considered",
			"- Session-based auth",
			"- OAuth2 only",
		].join("\n"),
	);
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Wiki Compiler", () => {
	describe("compile", () => {
		it("should return ok result on successful compilation", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
		});

		it("should produce articles array", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.articles.length).toBeGreaterThan(0);
		});

		it("should produce module articles", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const moduleArticles = result.value.articles.filter(
				(a) => a.type === "module",
			);
			expect(moduleArticles.length).toBeGreaterThan(0);
		});

		it("should produce entity articles for top entities", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const entityArticles = result.value.articles.filter(
				(a) => a.type === "entity",
			);
			expect(entityArticles.length).toBeGreaterThan(0);
		});

		it("should produce feature articles", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const featureArticles = result.value.articles.filter(
				(a) => a.type === "feature",
			);
			expect(featureArticles.length).toBe(1);
			expect(featureArticles[0]?.title).toContain("JWT Authentication");
		});

		it("should produce decision articles", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const decisionArticles = result.value.articles.filter(
				(a) => a.type === "decision",
			);
			expect(decisionArticles.length).toBe(1);
		});

		it("should produce an index article", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const indexArticle = result.value.articles.find(
				(a) => a.path === "wiki/index.md",
			);
			expect(indexArticle).toBeDefined();
			expect(indexArticle?.content).toContain("# Wiki Index");
		});

		it("should write articles to disk", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			// Check that index.md was written
			const indexPath = join(wikiDir, "index.md");
			expect(existsSync(indexPath)).toBe(true);

			const content = readFileSync(indexPath, "utf-8");
			expect(content).toContain("# Wiki Index");
		});

		it("should create directory structure on disk", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			// Module directory should exist
			expect(existsSync(join(wikiDir, "modules"))).toBe(true);
		});

		it("should save state after compilation", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const statePath = join(wikiDir, ".state.json");
			expect(existsSync(statePath)).toBe(true);

			const state = JSON.parse(readFileSync(statePath, "utf-8"));
			expect(state.lastFullCompile).toBeTruthy();
			expect(Object.keys(state.articleHashes).length).toBeGreaterThan(0);
		});

		it("should not write to disk in dry run mode", async () => {
			// Remove the wiki dir first to ensure it's clean
			rmSync(wikiDir, { recursive: true, force: true });
			mkdirSync(wikiDir, { recursive: true });

			const result = await compile(makeOptions({ dryRun: true }));
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			// index.md should not be written
			expect(existsSync(join(wikiDir, "index.md"))).toBe(false);
			// State should not be saved
			expect(existsSync(join(wikiDir, ".state.json"))).toBe(false);
		});

		it("should return compilation stats", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.stats.modules).toBeGreaterThanOrEqual(0);
			expect(result.value.stats.entities).toBeGreaterThanOrEqual(0);
			expect(result.value.stats.features).toBe(1);
			expect(result.value.stats.decisions).toBe(1);
			// Index article counts as architecture
			expect(result.value.stats.architecture).toBe(1);
		});

		it("should return duration in milliseconds", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.duration).toBeGreaterThanOrEqual(0);
		});

		it("should return the knowledge graph", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.graph.nodes.size).toBeGreaterThan(0);
			expect(result.value.graph.edges.length).toBeGreaterThan(0);
		});

		it("should set content hashes on all articles", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			for (const article of result.value.articles) {
				expect(article.contentHash).toBeTruthy();
				expect(article.contentHash).toMatch(/^[a-f0-9]{64}$/);
			}
		});

		it("should set lastCompiled timestamp on all articles", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			for (const article of result.value.articles) {
				expect(article.lastCompiled).toBeTruthy();
				// Should be a valid ISO date
				expect(Number.isNaN(new Date(article.lastCompiled).getTime())).toBe(
					false,
				);
			}
		});

		it("should handle empty repo gracefully", async () => {
			// Create an empty repo
			const emptyRepo = join(tmpDir, "empty-repo");
			const emptyMaina = join(emptyRepo, ".maina");
			const emptyWiki = join(emptyMaina, "wiki");
			mkdirSync(emptyWiki, { recursive: true });

			const result = await compile({
				repoRoot: emptyRepo,
				mainaDir: emptyMaina,
				wikiDir: emptyWiki,
				full: true,
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			// Should still produce an index article
			const indexArticle = result.value.articles.find(
				(a) => a.path === "wiki/index.md",
			);
			expect(indexArticle).toBeDefined();
		});

		it("should generate article content as valid markdown", async () => {
			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			for (const article of result.value.articles) {
				// Every article should start with a markdown heading
				expect(article.content.trimStart().startsWith("#")).toBe(true);
			}
		});

		it("should pass useAI flag through without crashing", async () => {
			// useAI: true should be accepted — AI will silently fall back since no key is set
			const result = await compile(makeOptions({ useAI: true }));
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.articles.length).toBeGreaterThan(0);
		});

		it("should compile normally when useAI is false", async () => {
			const result = await compile(makeOptions({ useAI: false }));
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.articles.length).toBeGreaterThan(0);
		});

		it("should skip test files and .d.ts files during extraction", async () => {
			// Create a test file and a .d.ts file
			writeFileSync(
				join(repoRoot, "src", "auth", "jwt.test.ts"),
				"export function testHelper(): void {}",
			);
			writeFileSync(
				join(repoRoot, "src", "auth", "jwt.d.ts"),
				"export declare function signToken(): string;",
			);

			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			// Test helper should not appear as an entity
			const hasTestHelper = result.value.articles.some((a) =>
				a.content.includes("testHelper"),
			);
			expect(hasTestHelper).toBe(false);
		});
	});

	// ── Monorepo architecture article reads package.json descriptions (#81) ──

	describe("monorepo architecture article", () => {
		it("should read descriptions from package.json instead of hardcoded values", async () => {
			// Set up a monorepo layout
			mkdirSync(join(repoRoot, "packages", "auth", "src"), {
				recursive: true,
			});
			mkdirSync(join(repoRoot, "packages", "cache"), {
				recursive: true,
			});

			// Root package.json with workspaces
			writeFileSync(
				join(repoRoot, "package.json"),
				JSON.stringify({
					name: "my-monorepo",
					description: "My awesome toolkit",
					workspaces: ["packages/*"],
				}),
			);

			// Package with description
			writeFileSync(
				join(repoRoot, "packages", "auth", "package.json"),
				JSON.stringify({
					name: "@my/auth",
					description: "Authentication and authorization library",
				}),
			);
			writeFileSync(
				join(repoRoot, "packages", "auth", "src", "index.ts"),
				"export function login() {}",
			);

			// Package without description but with README
			writeFileSync(
				join(repoRoot, "packages", "cache", "package.json"),
				JSON.stringify({ name: "@my/cache" }),
			);
			writeFileSync(
				join(repoRoot, "packages", "cache", "README.md"),
				"# Cache\n\nA fast caching layer.\n",
			);

			const result = await compile(makeOptions());
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const archArticle = result.value.articles.find((a) =>
				a.path.includes("monorepo-structure"),
			);
			expect(archArticle).toBeDefined();
			if (!archArticle) return;

			// Should use package.json description
			expect(archArticle.content).toContain(
				"Authentication and authorization library",
			);
			// Should use README fallback (first heading line)
			expect(archArticle.content).toContain("Cache");
			// Should NOT contain hardcoded placeholder
			expect(archArticle.content).not.toContain("_No description available._");
			// Should contain project description
			expect(archArticle.content).toContain("My awesome toolkit");
		}, 30_000);
	});
});
