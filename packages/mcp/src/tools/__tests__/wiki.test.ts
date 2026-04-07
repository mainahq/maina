import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "../../server";

// ─── Setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
	originalCwd = process.cwd();
	process.chdir(tmpDir);
});

afterEach(() => {
	process.chdir(originalCwd);
	rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helper to get tool callback ─────────────────────────────────────────

function getToolCallback(
	server: ReturnType<typeof createMcpServer>,
	toolName: string,
	// biome-ignore lint/suspicious/noExplicitAny: test helper accessing internals
): ((...args: any[]) => any) | undefined {
	// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test inspection
	const internal = server as any;
	const registered = internal._registeredTools?.[toolName];
	return registered?.handler;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function setupWiki(): string {
	const wikiDir = join(tmpDir, ".maina", "wiki");
	mkdirSync(join(wikiDir, "modules"), { recursive: true });
	mkdirSync(join(wikiDir, "entities"), { recursive: true });
	mkdirSync(join(wikiDir, "decisions"), { recursive: true });

	writeFileSync(
		join(wikiDir, "modules", "auth.md"),
		"# Authentication Module\n\nHandles user authentication, login, and session management.\n\nUses JWT tokens for stateless auth.",
	);
	writeFileSync(
		join(wikiDir, "modules", "db.md"),
		"# Database Module\n\nManages database connections, queries, and migrations.\n\nUses Drizzle ORM with bun:sqlite.",
	);
	writeFileSync(
		join(wikiDir, "entities", "user.md"),
		"# User Entity\n\nRepresents a user in the system.\n\nFields: id, email, name, role.",
	);
	writeFileSync(
		join(wikiDir, "decisions", "adr-001.md"),
		"# ADR-001: Use Bun Runtime\n\nWe decided to use Bun instead of Node.js for better performance.",
	);

	// State file for status
	writeFileSync(
		join(wikiDir, ".state.json"),
		JSON.stringify({
			fileHashes: {
				"src/auth.ts": "h1",
				"src/db.ts": "h2",
				"src/user.ts": "h3",
			},
			articleHashes: {
				"modules/auth.md": "a1",
				"modules/db.md": "a2",
			},
			lastFullCompile: "2026-04-07T10:00:00.000Z",
			lastIncrementalCompile: "2026-04-07T12:00:00.000Z",
			compilationPromptHash: "prompt_v1",
		}),
	);

	return wikiDir;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Wiki MCP Tools", () => {
	describe("wikiQuery", () => {
		it("should return answer and sources for known articles", async () => {
			setupWiki();
			const server = createMcpServer();
			const cb = getToolCallback(server, "wikiQuery");
			expect(cb).toBeDefined();
			if (!cb) return;

			const result = await cb({ question: "authentication login JWT" }, {});
			expect(result).toBeDefined();
			expect(result.isError).toBeUndefined();

			const parsed = JSON.parse(result.content[0].text);
			// New format: { answer, sources, cached }
			expect(parsed.answer).toBeDefined();
			expect(typeof parsed.answer).toBe("string");
			expect(parsed.sources.length).toBeGreaterThan(0);
			// Auth module should be in sources
			const hasAuth = parsed.sources.some((s: string) => s.includes("auth"));
			expect(hasAuth).toBe(true);
		});

		it("should return empty sources for irrelevant query", async () => {
			setupWiki();
			const server = createMcpServer();
			const cb = getToolCallback(server, "wikiQuery");
			if (!cb) return;

			const result = await cb({ question: "xyzzy plugh" }, {});
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.sources).toHaveLength(0);
			expect(parsed.answer).toContain("No articles match");
		});

		it("should handle missing wiki dir gracefully", async () => {
			// No wiki setup — cwd has no .maina/wiki
			const server = createMcpServer();
			const cb = getToolCallback(server, "wikiQuery");
			if (!cb) return;

			const result = await cb({ question: "authentication" }, {});
			expect(result.isError).toBeUndefined();

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.sources).toHaveLength(0);
			expect(parsed.answer).toContain("not initialized");
		});

		it("should include cached field in response", async () => {
			setupWiki();
			const server = createMcpServer();
			const cb = getToolCallback(server, "wikiQuery");
			if (!cb) return;

			const result = await cb({ question: "database" }, {});
			const parsed = JSON.parse(result.content[0].text);
			expect(typeof parsed.cached).toBe("boolean");
		});
	});

	describe("wikiStatus", () => {
		it("should return correct counts for initialized wiki", async () => {
			setupWiki();
			const server = createMcpServer();
			const cb = getToolCallback(server, "wikiStatus");
			expect(cb).toBeDefined();
			if (!cb) return;

			const result = await cb({}, {});
			expect(result.isError).toBeUndefined();

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.initialized).toBe(true);
			expect(parsed.totalArticles).toBe(4);
			expect(parsed.articlesByType.module).toBe(2);
			expect(parsed.articlesByType.entity).toBe(1);
			expect(parsed.articlesByType.decision).toBe(1);
			expect(parsed.lastCompile).toBe("2026-04-07T12:00:00.000Z");
		});

		it("should return coverage percentage", async () => {
			setupWiki();
			const server = createMcpServer();
			const cb = getToolCallback(server, "wikiStatus");
			if (!cb) return;

			const result = await cb({}, {});
			const parsed = JSON.parse(result.content[0].text);
			// 4 articles / 3 source files ≈ 100% (capped)
			expect(parsed.coveragePercent).toBeGreaterThan(0);
			expect(parsed.coveragePercent).toBeLessThanOrEqual(100);
		});

		it("should handle missing wiki dir gracefully", async () => {
			// No wiki setup
			const server = createMcpServer();
			const cb = getToolCallback(server, "wikiStatus");
			if (!cb) return;

			const result = await cb({}, {});
			expect(result.isError).toBeUndefined();

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.initialized).toBe(false);
			expect(parsed.totalArticles).toBe(0);
			expect(parsed.coveragePercent).toBe(0);
			expect(parsed.lastCompile).toBe("");
		});
	});
});
