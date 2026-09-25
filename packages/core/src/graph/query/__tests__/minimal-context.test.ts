import { describe, expect, test } from "bun:test";
import { calculateTokens } from "../../../context/budget";
import { minimalContext } from "../index";
import { FILES, indexedRepo, ROOT, unwrap } from "./fixture";

const BIG = 100_000;

/** What reading each file in full would cost. */
const naive = (...paths: (keyof typeof FILES)[]): number =>
	paths.reduce((sum, p) => sum + calculateTokens(FILES[p]), 0);

describe("minimalContext", () => {
	test("returns the target, what it calls and what calls it, as line-exact snippets", async () => {
		const repo = await indexedRepo();
		const ctx = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/mid.ts"],
				budgetTokens: BIG,
			}),
		);
		expect(ctx.snippets.map((s) => [s.id, s.reason])).toEqual([
			["src/mid.ts#mid", "target"],
			["src/core.ts#base", "callee"],
			["src/top.ts#top", "caller"],
		]);
		expect(ctx.snippets[0]).toMatchObject({
			path: "src/mid.ts",
			startLine: 3,
			endLine: 5,
			text: "export function mid(n: number): number {\n\treturn base(n) * 2;\n}",
		});
		expect(ctx.omitted).toEqual([]);
	});

	test("never spends more than the budget, filling it in priority order", async () => {
		const repo = await indexedRepo();
		const full = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/mid.ts"],
				budgetTokens: BIG,
			}),
		);
		const targetOnly = full.snippets[0]?.tokens ?? 0;
		expect(targetOnly).toBeGreaterThan(0);

		const tight = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/mid.ts"],
				budgetTokens: targetOnly + 1,
			}),
		);
		expect(tight.tokens).toBeLessThanOrEqual(targetOnly + 1);
		expect(tight.snippets.map((s) => s.id)).toEqual(["src/mid.ts#mid"]);
		expect(tight.omitted).toEqual(["src/core.ts#base", "src/top.ts#top"]);

		for (const budget of [0, 1, 5, 12, 20, 30, 50]) {
			const ctx = unwrap(
				await minimalContext(repo.ports, ROOT, {
					files: ["src/mid.ts"],
					budgetTokens: budget,
				}),
			);
			expect(ctx.tokens).toBeLessThanOrEqual(budget);
			expect(ctx.tokens).toBe(
				ctx.snippets.reduce((sum, s) => sum + s.tokens, 0),
			);
		}
	});

	test("savedTokens is measured against reading every touched file in full", async () => {
		const repo = await indexedRepo();
		const ctx = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/mid.ts"],
				budgetTokens: BIG,
			}),
		);
		const expected = naive("src/mid.ts", "src/core.ts", "src/top.ts");
		expect(ctx.naiveTokens).toBe(expected);
		expect(ctx.savedTokens).toBe(expected - ctx.tokens);
		expect(ctx.savedTokens).toBeGreaterThan(0);

		const empty = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/mid.ts"],
				budgetTokens: 0,
			}),
		);
		expect(empty.snippets).toEqual([]);
		expect(empty.tokens).toBe(0);
		expect(empty.savedTokens).toBe(expected);
	});

	test("a query seeds the context with its search hits", async () => {
		const repo = await indexedRepo();
		const ctx = unwrap(
			await minimalContext(repo.ports, ROOT, {
				query: "top",
				budgetTokens: BIG,
			}),
		);
		expect(ctx.snippets.map((s) => [s.id, s.reason])).toEqual([
			["src/top.ts#top", "target"],
			["src/mid.ts#mid", "callee"],
			["src/app.ts#app", "caller"],
		]);
		// The doc comment above `top` is outside its span, so it is not charged.
		expect(ctx.snippets[0]?.text.startsWith("export function top")).toBe(true);
	});

	test("depth widens the neighbourhood", async () => {
		const repo = await indexedRepo();
		const ctx = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/mid.ts"],
				budgetTokens: BIG,
				depth: 2,
			}),
		);
		expect(ctx.snippets.map((s) => s.id)).toEqual([
			"src/mid.ts#mid",
			"src/core.ts#base",
			"src/top.ts#top",
			"src/app.ts#app",
		]);
	});

	test("reports files that changed on disk since they were indexed", async () => {
		const repo = await indexedRepo();
		await repo.write("src/core.ts", "// moved\nexport const base = 1;\n");
		await repo.remove("src/top.ts");
		const ctx = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/mid.ts"],
				budgetTokens: BIG,
			}),
		);
		expect(ctx.stale).toEqual(["src/core.ts", "src/top.ts"]);
		expect(ctx.snippets.map((s) => s.id)).toEqual(["src/mid.ts#mid"]);
	});

	test("a seed file with no symbols contributes the whole file", async () => {
		const repo = await indexedRepo({
			"src/script.ts": "const x = 1;\nconsole.info(x);\n",
		});
		const ctx = unwrap(
			await minimalContext(repo.ports, ROOT, {
				files: ["src/script.ts"],
				budgetTokens: BIG,
			}),
		);
		expect(ctx.snippets.map((s) => [s.id, s.startLine, s.endLine])).toEqual([
			["src/script.ts", 1, 2],
		]);
	});
});
