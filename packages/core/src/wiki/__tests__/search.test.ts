/**
 * Tests for wiki search — Orama-powered full-text search over wiki articles.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildSearchIndex,
	loadSearchIndex,
	saveSearchIndex,
	searchWiki,
} from "../search";

// ── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;
let wikiDir: string;

function createTmpDir(): string {
	const dir = join(
		import.meta.dir,
		`tmp-search-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function seedWikiArticles(wiki: string): void {
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
		"raw",
	];
	for (const subdir of subdirs) {
		mkdirSync(join(wiki, subdir), { recursive: true });
	}

	writeFileSync(
		join(wiki, "modules", "core.md"),
		[
			"# Core Module",
			"",
			"The core module provides authentication and caching functionality.",
			"It manages user sessions and token validation.",
			"",
			"## Entities",
			"",
			"- `authenticate` (function)",
			"- `CacheManager` (class)",
			"- `Config` (interface)",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "modules", "verify.md"),
		[
			"# Verify Module",
			"",
			"The verify module runs the verification pipeline.",
			"It includes syntax guard, slop detection, and AI review.",
			"",
			"## Entities",
			"",
			"- `runPipeline` (function)",
			"- `syntaxGuard` (function)",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "entities", "user.md"),
		[
			"# User",
			"",
			"**Kind:** interface",
			"**File:** `packages/core/src/user.ts:5`",
			"",
			"Represents an authenticated user in the system.",
			"Contains email, role, and session token fields.",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "features", "login-flow.md"),
		[
			"# Feature: Login Flow",
			"",
			"Implements the authentication login flow with OAuth2.",
			"Users can sign in via Google or GitHub providers.",
			"",
			"## Tasks",
			"",
			"- [x] OAuth2 provider setup",
			"- [x] Session management",
			"- [ ] Remember me functionality",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "decisions", "use-bun.md"),
		[
			"# Decision: Use Bun Runtime",
			"",
			"> Status: **accepted**",
			"",
			"## Context",
			"",
			"We needed a fast JavaScript runtime for the CLI tool.",
			"",
			"## Decision",
			"",
			"Use Bun instead of Node.js for faster startup and built-in tools.",
			"",
			"## Rationale",
			"",
			"Bun provides built-in bundling, testing, and SQLite support.",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "architecture", "three-engines.md"),
		[
			"# Architecture: Three Engines",
			"",
			"Maina uses three engines: Context, Prompt, and Verify.",
			"Context observes, Prompt learns, Verify verifies.",
		].join("\n"),
	);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────

beforeEach(() => {
	tmpDir = createTmpDir();
	wikiDir = join(tmpDir, "wiki");
	mkdirSync(wikiDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
});

// ── buildSearchIndex ─────────────────────────────────────────────────────

describe("buildSearchIndex", () => {
	test("creates index from wiki articles", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		expect(index.articleCount).toBe(6);
	});

	test("handles empty wiki", async () => {
		// wikiDir exists but has no subdirectories with articles
		const index = await buildSearchIndex(wikiDir);

		expect(index.articleCount).toBe(0);
		const results = index.search("anything");
		expect(results).toEqual([]);
	});

	test("handles missing wiki directory", async () => {
		const index = await buildSearchIndex(join(tmpDir, "nonexistent"));

		expect(index.articleCount).toBe(0);
	});
});

// ── search (BM25 relevance) ─────────────────────────────────────────────

describe("search", () => {
	test("returns results sorted by relevance (BM25)", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		const results = index.search("authentication");
		expect(results.length).toBeGreaterThan(0);

		// Scores should be descending
		for (let i = 1; i < results.length; i++) {
			const prev = results[i - 1];
			const curr = results[i];
			expect(prev?.score ?? 0).toBeGreaterThanOrEqual(curr?.score ?? 0);
		}

		// Core module and login flow should be top hits for "authentication"
		const paths = results.map((r) => r.path);
		expect(paths.some((p) => p.includes("core") || p.includes("login"))).toBe(
			true,
		);
	});

	test("supports type filtering (only decisions)", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		const results = index.search("bun runtime", { type: "decision" });
		expect(results.length).toBeGreaterThan(0);
		for (const result of results) {
			expect(result.type).toBe("decision");
		}
	});

	test("supports type filtering (only modules)", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		const results = index.search("verification pipeline", { type: "module" });
		for (const result of results) {
			expect(result.type).toBe("module");
		}
	});

	test("handles typos (fuzzy matching)", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		// "autentication" is a typo for "authentication"
		const results = index.search("autentication");
		expect(results.length).toBeGreaterThan(0);

		const paths = results.map((r) => r.path);
		expect(paths.some((p) => p.includes("core") || p.includes("user"))).toBe(
			true,
		);
	});

	test("respects limit option", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		const results = index.search("module", { limit: 2 });
		expect(results.length).toBeLessThanOrEqual(2);
	});

	test("returns excerpt for each result", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		const results = index.search("authentication");
		for (const result of results) {
			expect(typeof result.excerpt).toBe("string");
		}
	});

	test("returns title and path for each result", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		const results = index.search("verify");
		for (const result of results) {
			expect(result.path).toBeTruthy();
			expect(result.title).toBeTruthy();
			expect(typeof result.score).toBe("number");
		}
	});
});

// ── saveSearchIndex + loadSearchIndex round-trip ─────────────────────────

describe("saveSearchIndex + loadSearchIndex", () => {
	test("round-trips correctly", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		await saveSearchIndex(wikiDir, index);
		const loaded = await loadSearchIndex(wikiDir);

		expect(loaded).not.toBeNull();
		expect(loaded?.articleCount).toBe(index.articleCount);

		// Search should return the same results
		const original = index.search("authentication");
		const restored = loaded?.search("authentication") ?? [];

		expect(restored.length).toBe(original.length);
		expect(restored.map((r) => r.path)).toEqual(original.map((r) => r.path));
	});

	test("loadSearchIndex returns null when no index file exists", async () => {
		const loaded = await loadSearchIndex(wikiDir);
		expect(loaded).toBeNull();
	});

	test("loadSearchIndex returns null on corrupted index", async () => {
		writeFileSync(join(wikiDir, ".search-index.json"), "not valid json{{{");
		const loaded = await loadSearchIndex(wikiDir);
		expect(loaded).toBeNull();
	});
});

// ── searchWiki convenience function ──────────────────────────────────────

describe("searchWiki", () => {
	test("works with persisted index", async () => {
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);
		await saveSearchIndex(wikiDir, index);

		const results = await searchWiki(wikiDir, "authentication");
		expect(results.length).toBeGreaterThan(0);
	});

	test("works without persisted index (builds in-memory)", async () => {
		seedWikiArticles(wikiDir);
		// No saveSearchIndex call — should fall back to building fresh
		const results = await searchWiki(wikiDir, "verify");
		expect(results.length).toBeGreaterThan(0);
	});

	test("returns empty for missing wiki directory", async () => {
		const results = await searchWiki(join(tmpDir, "nonexistent"), "anything");
		expect(results).toEqual([]);
	});

	test("supports type filtering", async () => {
		seedWikiArticles(wikiDir);

		const results = await searchWiki(wikiDir, "bun", { type: "decision" });
		for (const result of results) {
			expect(result.type).toBe("decision");
		}
	});

	test("supports limit option", async () => {
		seedWikiArticles(wikiDir);

		const results = await searchWiki(wikiDir, "module", { limit: 1 });
		expect(results.length).toBeLessThanOrEqual(1);
	});
});

// ── Performance ──────────────────────────────────────────────────────────

describe("performance", () => {
	test("indexing 400 articles < 500ms", async () => {
		// Create 400 articles across subdirectories
		const subdirs = ["modules", "entities", "features", "decisions"];
		for (const subdir of subdirs) {
			mkdirSync(join(wikiDir, subdir), { recursive: true });
		}

		for (let i = 0; i < 400; i++) {
			const subdir = subdirs[i % subdirs.length] ?? "modules";
			const content = [
				`# Article ${i}`,
				"",
				`This is article number ${i} about topic ${i % 20}.`,
				`It discusses various aspects of software development.`,
				`Keywords: authentication, caching, verification, pipeline, module.`,
				`More content to make the article realistic with enough text.`,
				`The ${subdir} subsystem handles ${i % 10 === 0 ? "authentication" : "processing"}.`,
			].join("\n");
			writeFileSync(join(wikiDir, subdir, `article-${i}.md`), content);
		}

		const start = performance.now();
		const index = await buildSearchIndex(wikiDir);
		const elapsed = performance.now() - start;

		expect(index.articleCount).toBe(400);
		expect(elapsed).toBeLessThan(500);
	});

	test("search < 10ms", async () => {
		// Reuse a seeded wiki
		seedWikiArticles(wikiDir);
		const index = await buildSearchIndex(wikiDir);

		const start = performance.now();
		const results = index.search("authentication caching");
		const elapsed = performance.now() - start;

		expect(results.length).toBeGreaterThan(0);
		expect(elapsed).toBeLessThan(10);
	});
});
