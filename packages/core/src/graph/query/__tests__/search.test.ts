import { describe, expect, test } from "bun:test";
import { createMemoryDb } from "../../../ports/testing";
import { search } from "../index";
import { indexedRepo, unwrap } from "./fixture";

describe("search", () => {
	test("ranks an exact name match first", async () => {
		const repo = await indexedRepo();
		const hits = unwrap(search(repo.ports, "mid"));
		expect(hits[0]?.id).toBe("src/mid.ts#mid");
		expect(hits.map((h) => h.id)).toContain("src/mid.test.ts#mid");
	});

	test("is case-insensitive and needs every term to match", async () => {
		const repo = await indexedRepo();
		const hits = unwrap(search(repo.ports, "CORE base"));
		expect(hits.map((h) => h.id)).toEqual([
			"src/core.ts#base",
			"src/core.test.ts#base",
			"src/core.test.ts#base > adds one",
		]);
	});

	test("carries the location of each hit", async () => {
		const repo = await indexedRepo();
		const [hit] = unwrap(search(repo.ports, "top"));
		expect(hit).toEqual({
			id: "src/top.ts#top",
			path: "src/top.ts",
			name: "top",
			qualifiedName: "top",
			kind: "function",
			test: false,
			startLine: 4,
			endLine: 6,
			score: expect.any(Number),
		});
	});

	test("honours limit and can leave tests out", async () => {
		const repo = await indexedRepo();
		expect(unwrap(search(repo.ports, "base", { limit: 1 }))).toHaveLength(1);
		const code = unwrap(search(repo.ports, "base", { includeTests: false }));
		expect(code.map((h) => h.id)).toEqual(["src/core.ts#base"]);
	});

	test("finds files by path", async () => {
		const repo = await indexedRepo();
		const hits = unwrap(search(repo.ports, "other.ts"));
		expect(hits[0]?.id).toBe("src/other.ts");
	});

	test("a blank query or empty store finds nothing", async () => {
		const repo = await indexedRepo();
		expect(unwrap(search(repo.ports, "   "))).toEqual([]);
		expect(unwrap(search({ db: createMemoryDb() }, "mid"))).toEqual([]);
	});
});
