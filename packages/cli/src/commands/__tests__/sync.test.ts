/**
 * Tests for `syncPullAction` — specifically the defensive handling of
 * malformed PromptRecords from the cloud, so a bad payload can no longer
 * leak out as `@clack/prompts`' generic "Something went wrong" (#196).
 *
 * Uses `mock.module` to stub `@mainahq/core`; requires the repo's isolated
 * test runner (`bun run test`) so the stub doesn't bleed into other files.
 */

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PromptRecord = {
	id: string;
	path: string;
	content: string;
	hash: string;
	updatedAt: string;
};

let mockPrompts: Array<Partial<PromptRecord>> = [];

// Keep the real pure helpers (the prompt-path guard, #662); only the auth and
// network edges are stubbed. Spread into a plain object before mocking so the
// copy is not the live, about-to-be-replaced module namespace.
const realCore = { ...(await import("@mainahq/core")) };

mock.module("@mainahq/core", () => ({
	...realCore,
	loadAuthConfig: () => ({ ok: true, value: { accessToken: "t" } }),
	createCloudClient: () => ({
		getPrompts: async () => ({ ok: true as const, value: mockPrompts }),
	}),
}));

// Import AFTER mocking
const { syncPullAction } = await import("../sync");

function makeTempRoot(): string {
	return mkdtempSync(join(tmpdir(), "maina-sync-test-"));
}

const tempRoots: string[] = [];

afterAll(() => {
	for (const dir of tempRoots) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
});

describe("syncPullAction", () => {
	test("writes well-formed prompts to disk", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [
			{
				id: "commit",
				path: "commit.md",
				content: "# Commit",
				hash: "h",
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(true);
		expect(result.count).toBe(1);
		expect(existsSync(join(root, ".maina", "prompts", "commit.md"))).toBe(true);
		expect(
			readFileSync(join(root, ".maina", "prompts", "commit.md"), "utf-8"),
		).toBe("# Commit");
	});

	test("returns friendly reason when team has no prompts", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(true);
		expect(result.count).toBe(0);
		expect(result.reason).toBe("No team prompts yet.");
	});

	test("skips records with missing path instead of throwing (#196)", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [
			{ id: "bad", content: "body" }, // no .path — join() would throw
			{
				id: "good",
				path: "good.md",
				content: "# Good",
				hash: "h",
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(true);
		expect(result.count).toBe(1);
		expect(result.reason).toContain("Skipped 1");
		expect(existsSync(join(root, ".maina", "prompts", "good.md"))).toBe(true);
	});

	test("skips records with non-string content", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [
			{ id: "bad", path: "bad.md" }, // no .content — writeFileSync would throw
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toContain("skipped");
	});

	test("fails cleanly if every record is malformed", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [
			{ id: "a" }, // missing path + content
			{ id: "b", path: "" }, // empty path
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toMatch(/All 2 prompt\(s\) skipped/);
	});

	// ── #662: never write outside .maina/prompts ────────────────────────────

	const traversalVectors: ReadonlyArray<readonly [string, string]> = [
		["parent traversal", "../../escaped.md"],
		["nested traversal", "sub/../../../escaped.md"],
		["backslash traversal", "..\\..\\escaped.md"],
		["forward-slash subdirectory", "sub/escaped.md"],
		["Windows drive", "C:\\escaped.md"],
		["Windows UNC", "\\\\server\\share\\escaped.md"],
		["non-markdown name", "escaped"],
	];

	test.each(
		traversalVectors,
	)("refuses a %s path (%p) and writes nothing", async (_label, path) => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [
			{ id: "evil", path, content: "pwned", hash: "h", updatedAt: "" },
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toContain("unsafe prompt path");
		expect(existsSync(join(root, "escaped.md"))).toBe(false);
		expect(existsSync(join(root, ".maina", "escaped.md"))).toBe(false);
		expect(readdirSync(join(root, ".maina", "prompts"))).toEqual([]);
	});

	test("refuses an absolute path that points outside the repo", async () => {
		const root = makeTempRoot();
		const outside = makeTempRoot();
		tempRoots.push(root, outside);
		const target = join(outside, "escaped.md");
		mockPrompts = [
			{ id: "evil", path: target, content: "pwned", hash: "h", updatedAt: "" },
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toContain("unsafe prompt path");
		expect(existsSync(target)).toBe(false);
	});

	test("writes the safe records and reports the unsafe ones", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [
			{ id: "evil", path: "../../escaped.md", content: "pwned" },
			{ id: "ok", path: "review.md", content: "# Review" },
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(true);
		expect(result.count).toBe(1);
		expect(result.reason).toContain("unsafe prompt path");
		expect(existsSync(join(root, "escaped.md"))).toBe(false);
		expect(
			readFileSync(join(root, ".maina", "prompts", "review.md"), "utf-8"),
		).toBe("# Review");
	});

	test("refuses to write through a symlinked prompt file", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		const promptsDir = join(root, ".maina", "prompts");
		mkdirSync(promptsDir, { recursive: true });
		const victim = join(root, "victim.md");
		writeFileSync(victim, "original", "utf-8");
		symlinkSync(victim, join(promptsDir, "review.md"));
		mockPrompts = [{ id: "review", path: "review.md", content: "pwned" }];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toContain("review.md");
		expect(result.reason).toContain("not a regular file");
		expect(readFileSync(victim, "utf-8")).toBe("original");
		expect(lstatSync(join(promptsDir, "review.md")).isSymbolicLink()).toBe(
			true,
		);
	});

	test("refuses to write through a dangling prompt-file symlink", async () => {
		const root = makeTempRoot();
		const outside = makeTempRoot();
		tempRoots.push(root, outside);
		const promptsDir = join(root, ".maina", "prompts");
		mkdirSync(promptsDir, { recursive: true });
		const victim = join(outside, "created.md");
		symlinkSync(victim, join(promptsDir, "review.md"));
		mockPrompts = [{ id: "review", path: "review.md", content: "pwned" }];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(existsSync(victim)).toBe(false);
	});

	test("refuses a .maina/prompts directory that resolves outside the repo", async () => {
		const root = makeTempRoot();
		const outside = makeTempRoot();
		tempRoots.push(root, outside);
		mkdirSync(join(root, ".maina"), { recursive: true });
		symlinkSync(outside, join(root, ".maina", "prompts"));
		mockPrompts = [{ id: "review", path: "review.md", content: "pwned" }];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toContain("outside");
		expect(readdirSync(outside)).toEqual([]);
	});

	test("creates nothing through a .maina symlinked outside the repo", async () => {
		const root = makeTempRoot();
		const outside = makeTempRoot();
		tempRoots.push(root, outside);
		symlinkSync(outside, join(root, ".maina"));
		mockPrompts = [{ id: "review", path: "review.md", content: "pwned" }];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toContain("outside");
		expect(readdirSync(outside)).toEqual([]);
	});
	test("refuses a dangling .maina/prompts symlink and creates nothing at its target", async () => {
		const root = makeTempRoot();
		const outside = makeTempRoot();
		tempRoots.push(root, outside);
		mkdirSync(join(root, ".maina"), { recursive: true });
		symlinkSync(join(outside, "planted"), join(root, ".maina", "prompts"));
		mockPrompts = [{ id: "review", path: "review.md", content: "pwned" }];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(readdirSync(outside)).toEqual([]);
	});

	// A hostile server's strings reach the terminal through the pull summary:
	// no raw control character (an ANSI escape could rewrite the screen) may
	// be echoed, whichever branch refuses the record.
	test("never echoes control characters from an unsafe path with no content", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [{ id: "evil", path: "\u001b]0;pwned\u0007x.md" }];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toContain(
			'unsafe prompt path "\\u001b]0;pwned\\u0007x.md"',
		);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence
		expect(result.reason).not.toMatch(/[\u0000-\u001f\u007f]/);
	});

	test("never echoes control characters from the id of a record without a path", async () => {
		const root = makeTempRoot();
		tempRoots.push(root);
		mockPrompts = [
			{ id: "\u001b[2Jwiped", content: "x" },
			{ id: Object.create(null) as unknown as string, content: "x" },
		];

		const result = await syncPullAction(root);

		expect(result.synced).toBe(false);
		expect(result.reason).toMatch(/All 2 prompt\(s\) skipped/);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence
		expect(result.reason).not.toMatch(/[\u0000-\u001f\u007f]/);
	});
});
