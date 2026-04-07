/**
 * Tests for wiki query — AI-powered question answering over wiki articles.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Mock AI before importing queryWiki ──────────────────────────────────

let mockAIResponse: {
	text: string | null;
	fromAI: boolean;
	hostDelegation: boolean;
	promptHash?: string;
} = { text: null, fromAI: false, hostDelegation: false };

mock.module(join(import.meta.dir, "..", "..", "ai", "try-generate"), () => ({
	tryAIGenerate: async () => mockAIResponse,
}));

const { queryWiki } = await import("../query");

// ── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;
let wikiDir: string;

function createTmpDir(): string {
	const dir = join(
		import.meta.dir,
		`tmp-query-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
			"",
			"## Exports",
			"",
			"- `authenticate` (function)",
			"- `CacheManager` (class)",
			"- `Config` (interface)",
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
			"# Login Flow",
			"",
			"## Acceptance Criteria",
			"",
			"- Users can log in with email and password",
			"- JWT tokens are issued on success",
			"- Failed attempts are rate-limited",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "decisions", "use-jwt.md"),
		[
			"# Use JWT for Authentication",
			"",
			"**Status:** accepted",
			"",
			"## Context",
			"",
			"We need stateless authentication for the API.",
			"",
			"## Decision",
			"",
			"Use JWT tokens with short expiry and refresh tokens.",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "architecture", "overview.md"),
		[
			"# Architecture Overview",
			"",
			"The system uses a layered architecture with three engines:",
			"Context, Prompt, and Verify.",
		].join("\n"),
	);
}

beforeEach(() => {
	tmpDir = createTmpDir();
	wikiDir = join(tmpDir, ".maina", "wiki");
	// Default: AI unavailable
	mockAIResponse = { text: null, fromAI: false, hostDelegation: false };
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("queryWiki", () => {
	test("returns not-initialized message when wiki dir missing", async () => {
		const result = await queryWiki({
			wikiDir: join(tmpDir, "nonexistent"),
			question: "test",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.answer).toContain("not initialized");
			expect(result.value.sources).toHaveLength(0);
		}
	});

	test("returns empty message when wiki has no articles", async () => {
		mkdirSync(join(wikiDir, "modules"), { recursive: true });

		const result = await queryWiki({ wikiDir, question: "anything" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.answer).toContain("empty");
			expect(result.value.sources).toHaveLength(0);
		}
	});

	test("returns no-match message for unrelated query", async () => {
		seedWikiArticles(wikiDir);

		const result = await queryWiki({
			wikiDir,
			question: "quantum computing blockchain",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.answer).toContain("No articles match");
			expect(result.value.sources).toHaveLength(0);
		}
	});

	test("falls back to keyword excerpts when AI unavailable", async () => {
		seedWikiArticles(wikiDir);
		mockAIResponse = { text: null, fromAI: false, hostDelegation: false };

		const result = await queryWiki({
			wikiDir,
			question: "authentication JWT",
			repoRoot: tmpDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.sources.length).toBeGreaterThan(0);
			expect(result.value.answer).toContain("keyword match");
			expect(result.value.cached).toBe(false);
			// Should find JWT decision or core module
			const hasAuthRelated = result.value.sources.some(
				(s) => s.includes("use-jwt") || s.includes("core"),
			);
			expect(hasAuthRelated).toBe(true);
		}
	});

	test("returns synthesized answer when AI is available", async () => {
		seedWikiArticles(wikiDir);
		mockAIResponse = {
			text: "Authentication uses JWT tokens as described in [[decisions/use-jwt.md]]. The core module provides the authenticate function [[modules/core.md]].",
			fromAI: true,
			hostDelegation: false,
			promptHash: "abc123",
		};

		const result = await queryWiki({
			wikiDir,
			question: "how does authentication work?",
			repoRoot: tmpDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.answer).toContain("JWT");
			expect(result.value.answer).toContain("[[decisions/use-jwt.md]]");
			expect(result.value.sources.length).toBeGreaterThan(0);
			expect(result.value.cached).toBe(false);
		}
	});

	test("respects maxArticles limit", async () => {
		seedWikiArticles(wikiDir);
		mockAIResponse = { text: null, fromAI: false, hostDelegation: false };

		// Add many more articles to exceed limit
		for (let i = 0; i < 15; i++) {
			writeFileSync(
				join(wikiDir, "entities", `entity-${i}.md`),
				`# Entity ${i}\n\nThis entity handles authentication task ${i}.`,
			);
		}

		const result = await queryWiki({
			wikiDir,
			question: "authentication",
			maxArticles: 3,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			// Sources should be limited to maxArticles
			expect(result.value.sources.length).toBeLessThanOrEqual(3);
		}
	});

	test("returns cached false for non-cached results", async () => {
		seedWikiArticles(wikiDir);

		const result = await queryWiki({
			wikiDir,
			question: "authentication",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.cached).toBe(false);
		}
	});

	test("handles AI error gracefully with fallback", async () => {
		seedWikiArticles(wikiDir);

		// Override mock to throw — re-mock the module
		mock.module(
			join(import.meta.dir, "..", "..", "ai", "try-generate"),
			() => ({
				tryAIGenerate: async () => {
					throw new Error("API key invalid");
				},
			}),
		);

		const result = await queryWiki({
			wikiDir,
			question: "authentication JWT",
			repoRoot: tmpDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			// Should still return fallback results
			expect(result.value.sources.length).toBeGreaterThan(0);
			expect(result.value.answer).toContain("keyword match");
		}

		// Restore normal mock
		mock.module(
			join(import.meta.dir, "..", "..", "ai", "try-generate"),
			() => ({
				tryAIGenerate: async () => mockAIResponse,
			}),
		);
	});

	test("scores title matches higher than content matches", async () => {
		seedWikiArticles(wikiDir);
		mockAIResponse = { text: null, fromAI: false, hostDelegation: false };

		const result = await queryWiki({
			wikiDir,
			question: "User",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			// "User" entity should rank high since it matches the title
			if (result.value.sources.length > 0) {
				expect(result.value.sources[0]).toContain("user");
			}
		}
	});
});
