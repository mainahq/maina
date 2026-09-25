import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	fetchPlan,
	isPinnedHead,
	PINNED_REPO,
	pinnedRepoDir,
} from "../fetch-100k-repo";

describe("PINNED_REPO", () => {
	test("is pinned to a full commit sha, never a branch", () => {
		expect(PINNED_REPO.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	test("is a public https clone url", () => {
		expect(PINNED_REPO.url).toMatch(
			/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/,
		);
	});
});

describe("pinnedRepoDir", () => {
	test("names the checkout after the repo and its commit", () => {
		expect(pinnedRepoDir("/cache", PINNED_REPO)).toBe(
			join("/cache", `${PINNED_REPO.name}-${PINNED_REPO.commit.slice(0, 12)}`),
		);
	});

	test("a different commit gets a different directory", () => {
		const other = { ...PINNED_REPO, commit: "f".repeat(40) };
		expect(pinnedRepoDir("/cache", other)).not.toBe(
			pinnedRepoDir("/cache", PINNED_REPO),
		);
	});
});

describe("fetchPlan", () => {
	test("fetches exactly the pinned commit, shallow, and checks it out", () => {
		const repo = {
			name: "demo",
			url: "https://github.com/acme/demo",
			commit: "a".repeat(40),
		};
		expect(fetchPlan(repo)).toEqual([
			["init", "--quiet"],
			["remote", "add", "origin", "https://github.com/acme/demo"],
			[
				"fetch",
				"--quiet",
				"--depth",
				"1",
				"--no-tags",
				"origin",
				"a".repeat(40),
			],
			["-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"],
		]);
	});
});

describe("isPinnedHead", () => {
	test("matches rev-parse output for the pinned commit", () => {
		expect(isPinnedHead(`${PINNED_REPO.commit}\n`, PINNED_REPO)).toBe(true);
	});

	test("rejects any other head", () => {
		expect(isPinnedHead(`${"0".repeat(40)}\n`, PINNED_REPO)).toBe(false);
		expect(isPinnedHead("", PINNED_REPO)).toBe(false);
	});
});
