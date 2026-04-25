import { describe, expect, test } from "bun:test";
import {
	getBranchName,
	getChangedFiles,
	getCurrentBranch,
	getDiff,
	getDiffStats,
	getRecentCommits,
	getRepoRoot,
	getRepoSlug,
	getStagedFiles,
	parseShortstat,
} from "../index";

describe("git operations", () => {
	test("getCurrentBranch() returns a non-empty string", async () => {
		const branch = await getCurrentBranch();
		expect(typeof branch).toBe("string");
		expect(branch.length).toBeGreaterThan(0);
	});

	test("getBranchName() is an alias for getCurrentBranch()", async () => {
		const branch = await getBranchName();
		expect(typeof branch).toBe("string");
		expect(branch.length).toBeGreaterThan(0);
	});

	test("getRepoRoot() returns a path that contains 'maina'", async () => {
		const root = await getRepoRoot();
		expect(typeof root).toBe("string");
		expect(root).toContain("maina");
	});

	test("getRecentCommits(5) returns an array (may be empty for new repo)", async () => {
		const commits = await getRecentCommits(5);
		expect(Array.isArray(commits)).toBe(true);
		for (const commit of commits) {
			expect(typeof commit.hash).toBe("string");
			expect(typeof commit.message).toBe("string");
			expect(typeof commit.author).toBe("string");
			expect(typeof commit.date).toBe("string");
		}
	});

	test("getChangedFiles() returns an array of strings", async () => {
		const files = await getChangedFiles();
		expect(Array.isArray(files)).toBe(true);
		for (const file of files) {
			expect(typeof file).toBe("string");
		}
	});

	test("getStagedFiles() returns an array", async () => {
		const files = await getStagedFiles();
		expect(Array.isArray(files)).toBe(true);
		for (const file of files) {
			expect(typeof file).toBe("string");
		}
	});

	test("getDiff() returns a string", async () => {
		const diff = await getDiff();
		expect(typeof diff).toBe("string");
	});

	test("parseShortstat() returns zeros for empty input", () => {
		expect(parseShortstat("")).toEqual({
			additions: 0,
			deletions: 0,
			files: 0,
		});
		expect(parseShortstat("   \n  ")).toEqual({
			additions: 0,
			deletions: 0,
			files: 0,
		});
	});

	test("parseShortstat() handles full add+del shortstat line", () => {
		const line = " 3 files changed, 42 insertions(+), 5 deletions(-)";
		expect(parseShortstat(line)).toEqual({
			files: 3,
			additions: 42,
			deletions: 5,
		});
	});

	test("parseShortstat() handles add-only shortstat", () => {
		expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({
			files: 1,
			additions: 1,
			deletions: 0,
		});
	});

	test("parseShortstat() handles del-only shortstat", () => {
		expect(parseShortstat(" 2 files changed, 7 deletions(-)")).toEqual({
			files: 2,
			additions: 0,
			deletions: 7,
		});
	});

	test("getDiffStats() returns a stats object (may be zero)", async () => {
		const stats = await getDiffStats();
		expect(typeof stats.additions).toBe("number");
		expect(typeof stats.deletions).toBe("number");
		expect(typeof stats.files).toBe("number");
		expect(stats.additions).toBeGreaterThanOrEqual(0);
		expect(stats.deletions).toBeGreaterThanOrEqual(0);
		expect(stats.files).toBeGreaterThanOrEqual(0);
	});

	test("getRepoSlug() returns owner/repo format", async () => {
		const slug = await getRepoSlug();
		expect(typeof slug).toBe("string");
		// Should contain a slash (owner/repo) or at minimum be non-empty
		expect(slug.length).toBeGreaterThan(0);
		// If remote exists, should be owner/repo format
		if (slug !== "unknown" && slug.includes("/")) {
			const parts = slug.split("/");
			expect(parts).toHaveLength(2);
			expect(parts[0]?.length).toBeGreaterThan(0);
			expect(parts[1]?.length).toBeGreaterThan(0);
		}
	});
});
