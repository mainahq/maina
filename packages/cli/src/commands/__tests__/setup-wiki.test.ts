/**
 * Tests for `seedWiki` — sub-task 6 of the setup wizard.
 *
 * The seeder is a thin coordinator around `wikiCompileAction` that handles:
 *  - empty-repo skip (no fake success)
 *  - already-present prompt (interactive) or default-keep (--yes/--ci)
 *  - 10s foreground budget; over → background continuation
 *  - background failure capture into `.maina/logs/setup.log`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SeedWikiOptions, seedWiki } from "../setup-wiki";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-seedwiki-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const NOOP_LOGGER = {
	info: () => {},
	warning: () => {},
	success: () => {},
};

function baseOpts(overrides: Partial<SeedWikiOptions> = {}): SeedWikiOptions {
	return {
		cwd: overrides.cwd ?? "/tmp",
		stackIsEmpty: false,
		wikiAlreadyPresent: false,
		interactive: false,
		yes: true,
		timeoutMs: 10_000,
		logger: NOOP_LOGGER,
		...overrides,
	};
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = makeTmpDir();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("seedWiki — empty repo", () => {
	test("returns skipped:'empty-repo' without invoking compile", async () => {
		let called = false;
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				stackIsEmpty: true,
				compile: async () => {
					called = true;
					return { pages: 0 };
				},
			}),
		);
		expect(called).toBe(false);
		expect(result.ran).toBe(false);
		expect(result.skipped).toBe("empty-repo");
		expect(result.pages).toBeNull();
		expect(result.backgrounded).toBe(false);
		expect(result.error).toBeNull();
	});
});

describe("seedWiki — already present", () => {
	test("interactive + user keeps → skipped:'user-kept', no compile", async () => {
		let called = false;
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				wikiAlreadyPresent: true,
				interactive: true,
				yes: false,
				prompt: async () => false, // do not rebuild
				compile: async () => {
					called = true;
					return { pages: 5 };
				},
			}),
		);
		expect(called).toBe(false);
		expect(result.ran).toBe(false);
		expect(result.skipped).toBe("user-kept");
	});

	test("interactive + user rebuilds → compile invoked", async () => {
		let called = false;
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				wikiAlreadyPresent: true,
				interactive: true,
				yes: false,
				prompt: async () => true,
				compile: async () => {
					called = true;
					return { pages: 7 };
				},
			}),
		);
		expect(called).toBe(true);
		expect(result.ran).toBe(true);
		expect(result.pages).toBe(7);
	});

	test("--yes mode defaults to keep (does not rebuild)", async () => {
		let called = false;
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				wikiAlreadyPresent: true,
				interactive: false,
				yes: true,
				compile: async () => {
					called = true;
					return { pages: 5 };
				},
			}),
		);
		expect(called).toBe(false);
		expect(result.skipped).toBe("user-kept");
	});
});

describe("seedWiki — happy path", () => {
	test("compile resolves before timeout → ran:true, pages:N, foreground", async () => {
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				timeoutMs: 1_000,
				compile: async () => ({ pages: 12 }),
			}),
		);
		expect(result.ran).toBe(true);
		expect(result.pages).toBe(12);
		expect(result.backgrounded).toBe(false);
		expect(result.error).toBeNull();
	});

	test("calls compile with sample:true and the cwd", async () => {
		const received: { cwd: string; sample: boolean }[] = [];
		await seedWiki(
			baseOpts({
				cwd: tmpDir,
				compile: async (o) => {
					received.push(o);
					return { pages: 1 };
				},
			}),
		);
		expect(received.length).toBe(1);
		expect(received[0]?.cwd).toBe(tmpDir);
		expect(received[0]?.sample).toBe(true);
	});
});

describe("seedWiki — timeout / backgrounding", () => {
	test("compile slower than timeoutMs → backgrounded:true, pages:null", async () => {
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				timeoutMs: 50,
				compile: () =>
					new Promise((resolve) =>
						setTimeout(() => resolve({ pages: 99 }), 200),
					),
			}),
		);
		expect(result.ran).toBe(true);
		expect(result.backgrounded).toBe(true);
		expect(result.pages).toBeNull();
		expect(result.error).toBeNull();
	});

	test("background failure writes to .maina/logs/setup.log", async () => {
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				timeoutMs: 30,
				compile: () =>
					new Promise((_resolve, reject) =>
						setTimeout(() => reject(new Error("boom-bg")), 100),
					),
			}),
		);
		expect(result.backgrounded).toBe(true);
		// Wait for background continuation to settle.
		await new Promise((r) => setTimeout(r, 200));
		const logPath = join(tmpDir, ".maina", "logs", "setup.log");
		expect(existsSync(logPath)).toBe(true);
		const content = readFileSync(logPath, "utf-8");
		expect(content).toContain("boom-bg");
	});
});

describe("seedWiki — compile errors in foreground", () => {
	test("compile rejects synchronously inside foreground window → error captured", async () => {
		const result = await seedWiki(
			baseOpts({
				cwd: tmpDir,
				timeoutMs: 1_000,
				compile: async () => {
					throw new Error("compile-failed");
				},
			}),
		);
		expect(result.ran).toBe(true);
		expect(result.backgrounded).toBe(false);
		expect(result.pages).toBeNull();
		expect(result.error).toContain("compile-failed");
	});
});
