import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const { wikiIngestAction } = await import("../wiki/ingest");

// ── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
	const dir = join(
		import.meta.dir,
		`tmp-wiki-ingest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	tmpDir = createTmpDir();
	mkdirSync(join(tmpDir, ".maina"), { recursive: true });
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

describe("maina wiki ingest", () => {
	test("ingests a local file into wiki/raw/", async () => {
		// Create source file
		const sourceFile = join(tmpDir, "notes.md");
		writeFileSync(sourceFile, "# My Notes\n\nSome content here.\n");

		const result = await wikiIngestAction(sourceFile, { cwd: tmpDir });

		expect(result.ingested).toBe(true);
		expect(result.source).toBe(sourceFile);
		expect(result.destination).toContain("wiki/raw/notes.md");
		expect(result.error).toBeUndefined();
	});

	test("file appears in wiki/raw/", async () => {
		const sourceFile = join(tmpDir, "design.md");
		const content = "# Design Doc\n\nArchitecture overview.\n";
		writeFileSync(sourceFile, content);

		const result = await wikiIngestAction(sourceFile, { cwd: tmpDir });

		expect(result.ingested).toBe(true);

		// Verify the file was actually written
		const rawDir = join(tmpDir, ".maina", "wiki", "raw");
		expect(existsSync(join(rawDir, "design.md"))).toBe(true);

		// Verify content matches
		const written = readFileSync(join(rawDir, "design.md"), "utf-8");
		expect(written).toBe(content);
	});

	test("handles missing source file", async () => {
		const result = await wikiIngestAction("/nonexistent/file.md", {
			cwd: tmpDir,
		});

		expect(result.ingested).toBe(false);
		expect(result.error).toContain("not found");
	});

	test("supports --json flag", async () => {
		const sourceFile = join(tmpDir, "data.md");
		writeFileSync(sourceFile, "# Data\n");

		const result = await wikiIngestAction(sourceFile, {
			cwd: tmpDir,
			json: true,
		});

		expect(result.ingested).toBe(true);
		expect(typeof result.source).toBe("string");
		expect(typeof result.destination).toBe("string");
	});

	test("sanitizes filenames with special characters", async () => {
		const sourceFile = join(tmpDir, "my file (v2).md");
		writeFileSync(sourceFile, "# Content\n");

		const result = await wikiIngestAction(sourceFile, { cwd: tmpDir });

		expect(result.ingested).toBe(true);
		// Filename should be sanitized — no spaces or parens
		expect(result.destination).not.toContain(" ");
		expect(result.destination).not.toContain("(");
	});

	test("creates wiki/raw/ directory if it does not exist", async () => {
		const rawDir = join(tmpDir, ".maina", "wiki", "raw");
		expect(existsSync(rawDir)).toBe(false);

		const sourceFile = join(tmpDir, "readme.md");
		writeFileSync(sourceFile, "# README\n");

		const result = await wikiIngestAction(sourceFile, { cwd: tmpDir });

		expect(result.ingested).toBe(true);
		expect(existsSync(rawDir)).toBe(true);
	});

	test("handles relative source path", async () => {
		const sourceFile = join(tmpDir, "relative.md");
		writeFileSync(sourceFile, "# Relative\n");

		const result = await wikiIngestAction("relative.md", { cwd: tmpDir });

		expect(result.ingested).toBe(true);
	});
});
