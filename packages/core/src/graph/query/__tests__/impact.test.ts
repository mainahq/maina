import { describe, expect, test } from "bun:test";
import { createMemoryDb } from "../../../ports/testing";
import { impact } from "../index";
import { indexedRepo, unwrap } from "./fixture";

const ids = (items: readonly { id: string }[]): readonly string[] =>
	items.map((i) => i.id);

describe("impact", () => {
	test("follows callers transitively up to the configured depth", async () => {
		const repo = await indexedRepo();
		const report = unwrap(
			impact(repo.ports, { symbols: ["src/core.ts#base"], depth: 2 }),
		);
		expect(report.callers.map((c) => [c.id, c.depth])).toEqual([
			["src/mid.ts#mid", 1],
			["src/top.ts#top", 2],
		]);
		expect(report.dependents).toEqual(["src/mid.ts", "src/top.ts"]);
	});

	test("lists the tests covering the target and every caller in range", async () => {
		const repo = await indexedRepo();
		const shallow = unwrap(
			impact(repo.ports, { symbols: ["src/core.ts#base"], depth: 2 }),
		);
		// `top` is in range but untested; `app > runs` covers `app`, one hop too far.
		expect(ids(shallow.tests)).toEqual([
			"src/core.test.ts#base > adds one",
			"src/mid.test.ts#mid > doubles",
		]);

		const deep = unwrap(
			impact(repo.ports, { symbols: ["src/core.ts#base"], depth: 3 }),
		);
		expect(ids(deep.callers)).toEqual([
			"src/mid.ts#mid",
			"src/top.ts#top",
			"src/app.ts#app",
		]);
		expect(ids(deep.tests)).toEqual([
			"src/app.test.ts#app > runs",
			"src/core.test.ts#base > adds one",
			"src/mid.test.ts#mid > doubles",
		]);
	});

	test("never reports tests or suites as callers", async () => {
		const repo = await indexedRepo();
		const report = unwrap(
			impact(repo.ports, { symbols: ["src/mid.ts#mid"], depth: 5 }),
		);
		expect(report.callers.some((c) => c.path.endsWith(".test.ts"))).toBe(false);
		expect(report.dependents.some((p) => p.endsWith(".test.ts"))).toBe(false);
	});

	test("a file target takes in every symbol in it and the files importing it", async () => {
		const repo = await indexedRepo();
		const report = unwrap(
			impact(repo.ports, { files: ["src/mid.ts"], depth: 1 }),
		);
		expect(ids(report.callers)).toEqual(["src/top.ts#top"]);
		expect(report.dependents).toEqual(["src/top.ts"]);
		// The test file also imports mid.ts, but its case already stands for it.
		expect(ids(report.tests)).toEqual(["src/mid.test.ts#mid > doubles"]);
	});

	test("blastScore is the share of the other non-test files that depend on the target", async () => {
		const repo = await indexedRepo();
		// Five non-test files, one of them the target: 2 of the other 4 depend on it.
		const two = unwrap(
			impact(repo.ports, { symbols: ["src/core.ts#base"], depth: 2 }),
		);
		expect(two.blastScore).toBe(0.5);
		const three = unwrap(
			impact(repo.ports, { symbols: ["src/core.ts#base"], depth: 3 }),
		);
		expect(three.blastScore).toBe(0.75);
		const none = unwrap(
			impact(repo.ports, { symbols: ["src/other.ts#other"] }),
		);
		expect(none.callers).toEqual([]);
		expect(none.blastScore).toBe(0);
	});

	test("resolves symbols by qualified name and reports the ones it cannot find", async () => {
		const repo = await indexedRepo();
		const report = unwrap(
			impact(repo.ports, { symbols: ["base", "nope"], files: ["gone.ts"] }),
		);
		expect(ids(report.targets)).toEqual(["src/core.ts#base"]);
		expect(report.unknown).toEqual(["gone.ts", "nope"]);
		expect(ids(report.callers)).toContain("src/mid.ts#mid");
	});

	test("a class target covers callers of its members", async () => {
		const repo = await indexedRepo({
			"src/shape.ts": `export class Square {
	area(): number {
		return 4;
	}
}
`,
			"src/use.ts": `import { Square } from "./shape";

export function useIt(s: Square): number {
	return s.area();
}

export function make(): number {
	return new Square().area();
}
`,
		});
		const report = unwrap(
			impact(repo.ports, { symbols: ["src/shape.ts#Square"] }),
		);
		expect(ids(report.callers)).toContain("src/use.ts#make");
		expect(report.dependents).toEqual(["src/use.ts"]);
	});

	test("an empty store yields an empty report", () => {
		const report = unwrap(
			impact({ db: createMemoryDb() }, { files: ["src/a.ts"] }),
		);
		expect(report).toEqual({
			targets: [],
			unknown: ["src/a.ts"],
			callers: [],
			dependents: [],
			tests: [],
			blastScore: 0,
		});
	});
});
