import { describe, expect, test } from "bun:test";
import {
	getBranchName,
	getChangedFiles,
	getCurrentBranch,
	getDiff,
	getRecentCommits,
	getRepoRoot,
	getStagedFiles,
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
});
