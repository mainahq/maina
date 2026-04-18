/**
 * Tests for `syncPullAction` — specifically the defensive handling of
 * malformed PromptRecords from the cloud, so a bad payload can no longer
 * leak out as `@clack/prompts`' generic "Something went wrong" (#196).
 *
 * Uses `mock.module` to stub `@mainahq/core`; requires the repo's isolated
 * test runner (`bun run test`) so the stub doesn't bleed into other files.
 */

import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

mock.module("@mainahq/core", () => ({
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
});
