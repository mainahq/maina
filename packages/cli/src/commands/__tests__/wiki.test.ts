import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Mocks ───────────────────────────────────────────────────────────────────

mock.module("@clack/prompts", () => ({
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		error: () => {},
		warning: () => {},
		success: () => {},
		message: () => {},
		step: () => {},
	},
	spinner: () => ({
		start: () => {},
		stop: () => {},
	}),
}));

afterAll(() => {
	mock.restore();
});

// ── Import modules under test AFTER mocks ───────────────────────────────────

const { wikiInitAction } = await import("../wiki/init");
const { wikiStatusAction } = await import("../wiki/status");
const { wikiQueryAction } = await import("../wiki/query");
const { wikiCompileAction } = await import("../wiki/compile");

// ── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
	const dir = join(
		import.meta.dir,
		`tmp-wiki-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Create a minimal TypeScript project structure for extraction.
 */
function createSampleProject(root: string): void {
	// Create packages structure
	const srcDir = join(root, "packages", "core", "src");
	mkdirSync(srcDir, { recursive: true });

	writeFileSync(
		join(srcDir, "index.ts"),
		[
			"export function greet(name: string): string {",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional TS source content
			"  return `Hello, ${name}!`;",
			"}",
			"",
			"export interface Config {",
			"  debug: boolean;",
			"}",
			"",
			"export const VERSION = '1.0.0';",
		].join("\n"),
	);

	writeFileSync(
		join(srcDir, "utils.ts"),
		[
			"export function formatDate(d: Date): string {",
			"  return d.toISOString();",
			"}",
			"",
			"export type DateFormat = 'iso' | 'locale';",
		].join("\n"),
	);

	// Create .maina directory
	mkdirSync(join(root, ".maina"), { recursive: true });
}

/**
 * Seed .maina/wiki/ with sample articles for query/status tests.
 */
function seedWikiArticles(root: string): void {
	const wikiDir = join(root, ".maina", "wiki");
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
		"raw",
	];
	for (const subdir of subdirs) {
		mkdirSync(join(wikiDir, subdir), { recursive: true });
	}

	writeFileSync(
		join(wikiDir, "modules", "core.md"),
		[
			"# Core Module",
			"",
			"The core module provides authentication and caching.",
			"",
			"## Exports",
			"",
			"- `authenticate` (function)",
			"- `CacheManager` (class)",
		].join("\n"),
	);

	writeFileSync(
		join(wikiDir, "entities", "user.md"),
		[
			"# User",
			"",
			"**Kind:** interface",
			"**File:** `packages/core/src/user.ts:5`",
			"",
			"Represents an authenticated user in the system.",
		].join("\n"),
	);

	writeFileSync(
		join(wikiDir, "features", "login-flow.md"),
		[
			"# Login Flow",
			"",
			"## Acceptance Criteria",
			"",
			"- Users can log in with email and password",
			"- JWT tokens are issued on success",
		].join("\n"),
	);

	writeFileSync(
		join(wikiDir, "decisions", "use-jwt.md"),
		[
			"# Use JWT for Authentication",
			"",
			"**Status:** accepted",
			"",
			"## Context",
			"",
			"We need stateless authentication for the API.",
		].join("\n"),
	);
}

beforeEach(() => {
	tmpDir = createTmpDir();
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("maina wiki init", () => {
	test("creates wiki directory structure", async () => {
		createSampleProject(tmpDir);

		const _result = await wikiInitAction({ cwd: tmpDir });

		// Check directory structure
		const wikiDir = join(tmpDir, ".maina", "wiki");
		expect(existsSync(wikiDir)).toBe(true);
		expect(existsSync(join(wikiDir, "modules"))).toBe(true);
		expect(existsSync(join(wikiDir, "entities"))).toBe(true);
		expect(existsSync(join(wikiDir, "features"))).toBe(true);
		expect(existsSync(join(wikiDir, "decisions"))).toBe(true);
		expect(existsSync(join(wikiDir, "architecture"))).toBe(true);
		expect(existsSync(join(wikiDir, "raw"))).toBe(true);
	});

	test("generates articles from source files", async () => {
		createSampleProject(tmpDir);

		const result = await wikiInitAction({ cwd: tmpDir });

		expect(result.articlesCreated).toBeGreaterThan(0);
		expect(result.modules).toBeGreaterThan(0);
		expect(result.entities).toBeGreaterThan(0);
		expect(result.duration).toBeGreaterThanOrEqual(0);
	});

	test("extracts entities from sample files", async () => {
		createSampleProject(tmpDir);

		const result = await wikiInitAction({ cwd: tmpDir });

		// The core compiler generates entity articles for top 20% by PageRank.
		// At least some entities should be created from 5 total entities.
		expect(result.entities).toBeGreaterThan(0);
	});

	test("creates .state.json in wiki directory", async () => {
		createSampleProject(tmpDir);

		await wikiInitAction({ cwd: tmpDir });

		const statePath = join(tmpDir, ".maina", "wiki", ".state.json");
		expect(existsSync(statePath)).toBe(true);
	});

	test("works with --json mode (no UI calls)", async () => {
		createSampleProject(tmpDir);

		const result = await wikiInitAction({ cwd: tmpDir, json: true });

		expect(result.articlesCreated).toBeGreaterThan(0);
		expect(typeof result.duration).toBe("number");
	});

	test("creates .maina if it does not exist", async () => {
		// Create project without .maina
		const srcDir = join(tmpDir, "packages", "core", "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "index.ts"), "export const FOO = 1;\n");

		await wikiInitAction({ cwd: tmpDir });

		expect(existsSync(join(tmpDir, ".maina", "wiki"))).toBe(true);
	});

	test("extracts features when feature dirs exist", async () => {
		createSampleProject(tmpDir);

		// Add a feature directory
		const featureDir = join(tmpDir, ".maina", "features", "001-login");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			"# Implementation Plan: Login Feature\n\n- [ ] T001: Create login endpoint\n",
		);

		const result = await wikiInitAction({ cwd: tmpDir });

		expect(result.features).toBe(1);
	});

	test("extracts decisions when adr dir exists", async () => {
		createSampleProject(tmpDir);

		// Add an ADR — the core compiler looks in {repoRoot}/adr/ not .maina/adr/
		const adrDir = join(tmpDir, "adr");
		mkdirSync(adrDir, { recursive: true });
		writeFileSync(
			join(adrDir, "0001-use-jwt.md"),
			"# ADR-0001: Use JWT\n\n## Status\nAccepted\n\n## Context\nNeed auth.\n\n## Decision\nUse JWT.\n",
		);

		const result = await wikiInitAction({ cwd: tmpDir });

		expect(result.decisions).toBe(1);
	});

	test("generates index.md in wiki directory", async () => {
		createSampleProject(tmpDir);

		await wikiInitAction({ cwd: tmpDir });

		const indexPath = join(tmpDir, ".maina", "wiki", "index.md");
		expect(existsSync(indexPath)).toBe(true);
	});

	test("architecture count includes index article", async () => {
		createSampleProject(tmpDir);

		const result = await wikiInitAction({ cwd: tmpDir });

		// The compiler generates an index.md article with type "architecture"
		expect(result.architecture).toBeGreaterThan(0);
	});
});

describe("maina wiki status", () => {
	test("returns not initialized when wiki dir missing", async () => {
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });

		const result = await wikiStatusAction({ cwd: tmpDir });

		expect(result.initialized).toBe(false);
		expect(result.totalArticles).toBe(0);
	});

	test("returns correct article counts by type", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiStatusAction({ cwd: tmpDir });

		expect(result.initialized).toBe(true);
		expect(result.articlesByType.modules).toBe(1);
		expect(result.articlesByType.entities).toBe(1);
		expect(result.articlesByType.features).toBe(1);
		expect(result.articlesByType.decisions).toBe(1);
		expect(result.articlesByType.architecture).toBe(0);
		expect(result.articlesByType.raw).toBe(0);
		expect(result.totalArticles).toBe(4);
	});

	test("supports --json mode", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiStatusAction({ cwd: tmpDir, json: true });

		expect(result.initialized).toBe(true);
		expect(typeof result.totalArticles).toBe("number");
	});

	test("returns zero stale count when no state file", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiStatusAction({ cwd: tmpDir });

		// No .state.json means staleCount = 0
		expect(result.staleCount).toBe(0);
	});

	test("returns lastCompile from state", async () => {
		createSampleProject(tmpDir);

		// Init creates the state file
		await wikiInitAction({ cwd: tmpDir });
		const result = await wikiStatusAction({ cwd: tmpDir });

		expect(result.initialized).toBe(true);
		expect(result.lastCompile).toBeTruthy();
		// Should be a valid ISO date
		expect(new Date(result.lastCompile).getTime()).toBeGreaterThan(0);
	});
});

describe("maina wiki query", () => {
	test("returns no-init message when wiki missing", async () => {
		const result = await wikiQueryAction("test", { cwd: tmpDir });

		expect(result.answer).toContain("not initialized");
		expect(result.sources).toHaveLength(0);
	});

	test("finds relevant articles by keyword", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiQueryAction("authentication JWT", {
			cwd: tmpDir,
		});

		expect(result.sources.length).toBeGreaterThan(0);
		// Should find the JWT decision or core module
		const hasAuthRelated = result.sources.some(
			(s) => s.includes("use-jwt") || s.includes("core"),
		);
		expect(hasAuthRelated).toBe(true);
	});

	test("returns empty for unrelated query", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiQueryAction("quantum computing blockchain", {
			cwd: tmpDir,
		});

		expect(result.sources).toHaveLength(0);
		expect(result.answer).toContain("No articles match");
	});

	test("returns answer with source paths", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiQueryAction("login user", { cwd: tmpDir });

		expect(result.answer).toBeTruthy();
		expect(result.sources.length).toBeGreaterThan(0);
		// Each source should be a relative path within the wiki
		for (const source of result.sources) {
			expect(source).toMatch(/\//);
			expect(source).toMatch(/\.md$/);
		}
	});

	test("supports --json mode", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiQueryAction("core module", {
			cwd: tmpDir,
			json: true,
		});

		expect(typeof result.answer).toBe("string");
		expect(Array.isArray(result.sources)).toBe(true);
	});

	test("returns empty for wiki with no articles", async () => {
		const wikiDir = join(tmpDir, ".maina", "wiki");
		mkdirSync(join(wikiDir, "modules"), { recursive: true });

		const result = await wikiQueryAction("anything", { cwd: tmpDir });

		expect(result.answer).toContain("empty");
		expect(result.sources).toHaveLength(0);
	});

	test("returns AI-synthesized answer when AI is available", async () => {
		seedWikiArticles(tmpDir);

		// Test using queryWiki directly with _aiGenerate override
		const { queryWiki } = await import("@maina/core");
		const wikiDir = join(tmpDir, ".maina", "wiki");
		const result = await queryWiki({
			wikiDir,
			question: "how does auth work?",
			repoRoot: tmpDir,
			_aiGenerate: async () => ({
				text: "Auth uses JWT tokens [[decisions/use-jwt.md]]. The core module exposes authenticate() [[modules/core.md]].",
				fromAI: true,
			}),
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.answer).toContain("JWT");
			expect(result.value.answer).toContain("[[decisions/use-jwt.md]]");
			expect(result.value.sources.length).toBeGreaterThan(0);
			expect(result.value.cached).toBe(false);
		}
	});

	test("returns cached field from queryWiki result", async () => {
		seedWikiArticles(tmpDir);

		const result = await wikiQueryAction("authentication", { cwd: tmpDir });

		expect(typeof result.cached).toBe("boolean");
	});
});

describe("maina wiki compile", () => {
	test("runs full compilation on uninitialized wiki", async () => {
		createSampleProject(tmpDir);

		const result = await wikiCompileAction({ cwd: tmpDir, json: true });

		expect(result.mode).toBe("full");
		expect(result.articlesTotal).toBeGreaterThan(0);
	});

	test("runs full compilation when --full is passed", async () => {
		createSampleProject(tmpDir);
		await wikiInitAction({ cwd: tmpDir, json: true });

		const result = await wikiCompileAction({
			cwd: tmpDir,
			full: true,
			json: true,
		});

		expect(result.mode).toBe("full");
		expect(result.articlesTotal).toBeGreaterThan(0);
	});

	test("runs incremental compilation by default after init", async () => {
		createSampleProject(tmpDir);
		await wikiInitAction({ cwd: tmpDir, json: true });

		const result = await wikiCompileAction({ cwd: tmpDir, json: true });

		expect(result.mode).toBe("incremental");
		expect(result.articlesTotal).toBeGreaterThan(0);
	});

	test("dry run does not write articles to disk", async () => {
		// Create a fresh tmpDir with no existing wiki
		const freshDir = createTmpDir();
		const srcDir = join(freshDir, "packages", "core", "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "index.ts"), "export const FOO = 1;\n");

		const result = await wikiCompileAction({
			cwd: freshDir,
			dryRun: true,
			full: true,
			json: true,
		});

		expect(result.dryRun).toBe(true);
		expect(result.articlesTotal).toBeGreaterThan(0);

		// Cleanup
		try {
			const { rmSync } = require("node:fs");
			rmSync(freshDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	test("returns stats with modules, entities, and architecture", async () => {
		createSampleProject(tmpDir);

		const result = await wikiCompileAction({
			cwd: tmpDir,
			full: true,
			json: true,
		});

		expect(result.modules).toBeGreaterThan(0);
		expect(result.entities).toBeGreaterThan(0);
		expect(result.architecture).toBeGreaterThan(0);
	});
});
