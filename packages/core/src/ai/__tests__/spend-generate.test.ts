/**
 * #463: `generate()` reads real spend from a ledger, records what each model
 * call cost, and keeps its routing log, so `budget.dailyUsd` and
 * `budget.perTaskUsd` hold across calls. Everything runs against a fake
 * clock, an in-memory ledger and a fake model call.
 */

import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFakeEnv,
	createFixedClock,
	createMemoryDb,
	createMemoryLogger,
} from "../../ports/testing";
import { generate } from "../index";
import { createSpendLedger, runAsSpendTask } from "../spend";

const DAY_MS = 24 * 60 * 60 * 1000;
const AFTERNOON = Date.UTC(2026, 8, 26, 15, 30);
/** 8k in, 1k out: $0.015 mechanical, $0.04 standard, $0.07 architectural. */
const TYPICAL = { input: 8_000, output: 1_000 };

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A repo root whose config sets `budget` and names each tier's model. */
function repoWithBudget(budget: string): string {
	const root = mkdtempSync(join(tmpdir(), "maina-463-spend-"));
	roots.push(root);
	writeFileSync(
		join(root, "maina.config.js"),
		`module.exports = {
			provider: "openrouter",
			models: { mechanical: "m-cheap", standard: "m-mid", architectural: "m-top" },
			budget: ${budget},
		};`,
	);
	return root;
}

type ModelCall = Readonly<{ modelId: string; user: string }>;

function harness(root: string, tokens: typeof TYPICAL | undefined = TYPICAL) {
	const clock = createFixedClock(AFTERNOON);
	const created = createSpendLedger({ db: createMemoryDb(), clock });
	if (!created.ok) throw new Error(created.error.message);
	const ledger = created.value;
	const logger = createMemoryLogger();
	const calls: ModelCall[] = [];
	let n = 0;
	const run = (task: string, userPrompt = `prompt ${++n}`) =>
		generate({
			task,
			systemPrompt: "s",
			userPrompt,
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({ MAINA_API_KEY: "test-key" }),
			ledger,
			logger,
			callModel: async (request) => {
				calls.push({ modelId: request.modelId, user: request.user });
				return { text: `answer to ${request.user}`, tokens };
			},
		});
	return { clock, ledger, logger, calls, run };
}

describe("the daily cap holds across calls", () => {
	test("a second call in the same day that crosses dailyUsd stops", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 0.02, perTaskUsd: null, onBreach: 'stop' }",
		);
		const { run, calls, ledger } = harness(root);

		const first = await run("commit");
		expect(first.budgetStop).toBeUndefined();
		expect(first.text).toBe("answer to prompt 1");
		const spent = ledger.spend("any");
		expect(spent.ok && spent.value.todayUsd).toBeCloseTo(0.015, 10);

		const second = await run("commit");
		expect(second.budgetStop).toContain("budget.dailyUsd");
		expect(second.budgetStop).toContain("$0.02");
		expect(calls).toHaveLength(1);
	});

	test("the next UTC day starts from zero", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 0.02, perTaskUsd: null, onBreach: 'stop' }",
		);
		const { run, clock, calls } = harness(root);
		await run("commit");
		expect((await run("commit")).budgetStop).toBeDefined();

		clock.advance(DAY_MS);
		const nextDay = await run("commit");
		expect(nextDay.budgetStop).toBeUndefined();
		expect(calls).toHaveLength(2);
	});

	test("with onBreach=degrade the second call runs on a cheaper tier that fits", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 0.1, perTaskUsd: null, onBreach: 'degrade' }",
		);
		const { run, calls, logger } = harness(root);

		await run("design-review");
		const second = await run("design-review");
		expect(second.budgetStop).toBeUndefined();
		// $0.07 spent: standard ($0.04) would cross $0.10, mechanical fits.
		expect(calls.map((c) => c.modelId)).toEqual(["m-top", "m-cheap"]);
		expect(second.model).toBe("m-cheap");
		const routed = logger.entries().filter((e) => e.message === "model routed");
		expect(routed.at(-1)?.fields).toMatchObject({
			tier: "mechanical",
			degradedFrom: "architectural",
			breachedCap: "dailyUsd",
		});
	});

	test("without reported usage the call is charged its estimate", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 5, perTaskUsd: null, onBreach: 'stop' }",
		);
		const { run, ledger } = harness(root, undefined);
		await run("design-review");
		const spent = ledger.spend("any");
		expect(spent.ok && spent.value.todayUsd).toBeCloseTo(0.07, 10);
	});
});

describe("the per-task cap sees a command's accumulated spend", () => {
	test("calls in one task add up; a new task starts from zero", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: null, perTaskUsd: 0.02, onBreach: 'stop' }",
		);
		const { run, calls } = harness(root);

		const within = await runAsSpendTask(async () => [
			await run("commit"),
			await run("commit"),
		]);
		expect(within[0]?.budgetStop).toBeUndefined();
		expect(within[1]?.budgetStop).toContain("budget.perTaskUsd");

		const fresh = await runAsSpendTask(() => run("commit"));
		expect(fresh.budgetStop).toBeUndefined();
		expect(calls).toHaveLength(2);
	});
});

describe("a cache hit costs nothing", () => {
	test("a cached answer is served even when the budget is spent, and adds no spend", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 0.02, perTaskUsd: null, onBreach: 'stop' }",
		);
		const { run, calls, ledger, logger } = harness(root);

		await run("commit", "same prompt");
		const before = ledger.spend("any");
		const again = await run("commit", "same prompt");

		expect(again.cached).toBe(true);
		expect(again.budgetStop).toBeUndefined();
		expect(again.text).toBe("answer to same prompt");
		expect(calls).toHaveLength(1);
		expect(ledger.spend("any")).toEqual(before);
		const routed = logger.entries().filter((e) => e.message === "model routed");
		expect(routed).toHaveLength(1);
	});

	test("an answer cached on the degraded tier is served again without a new call or charge", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 0.1, perTaskUsd: null, onBreach: 'degrade' }",
		);
		const { run, calls, ledger, logger } = harness(root);

		await run("design-review", "first");
		// $0.07 spent: this one degrades to mechanical and is cached there.
		const degraded = await run("design-review", "repeat");
		expect(degraded.model).toBe("m-cheap");
		const before = ledger.spend("any");
		const routedBefore = logger
			.entries()
			.filter((e) => e.message === "model routed").length;

		const again = await run("design-review", "repeat");
		expect(again.cached).toBe(true);
		expect(again.text).toBe("answer to repeat");
		expect(calls.map((c) => c.modelId)).toEqual(["m-top", "m-cheap"]);
		expect(ledger.spend("any")).toEqual(before);
		const routedAfter = logger
			.entries()
			.filter((e) => e.message === "model routed").length;
		expect(routedAfter).toBe(routedBefore);
	});
});

describe("a failed model call", () => {
	test("records no spend", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 5, perTaskUsd: null, onBreach: 'stop' }",
		);
		const clock = createFixedClock(AFTERNOON);
		const created = createSpendLedger({ db: createMemoryDb(), clock });
		if (!created.ok) throw new Error(created.error.message);
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({ MAINA_API_KEY: "test-key" }),
			ledger: created.value,
			logger: createMemoryLogger(),
			callModel: async () => null,
		});
		expect(result.text).toContain("AI call failed");
		expect(created.value.spend("any")).toEqual({
			ok: true,
			value: { todayUsd: 0, taskUsd: 0 },
		});
	});
});

describe("production wiring", () => {
	test("without injected ports, spend and routing entries land in .maina/stats.db", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 5, perTaskUsd: null, onBreach: 'stop' }",
		);
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({ MAINA_API_KEY: "test-key" }),
			callModel: async () => ({ text: "ok", tokens: TYPICAL }),
		});
		expect(result.text).toBe("ok");

		const db = new Database(join(root, ".maina", "stats.db"), {
			readonly: true,
		});
		try {
			const spend = db
				.query("SELECT task, tier, model, cost_usd FROM model_spend")
				.all() as { task: string; tier: string; cost_usd: number }[];
			expect(spend).toHaveLength(1);
			expect(spend[0]).toMatchObject({
				task: "commit",
				tier: "mechanical",
				model: "m-cheap",
			});
			expect(spend[0]?.cost_usd).toBeCloseTo(0.015, 10);
			const log = db
				.query("SELECT level, message FROM model_log ORDER BY seq")
				.all();
			expect(log).toEqual([{ level: "info", message: "model routed" }]);
		} finally {
			db.close();
		}
	});
});

/** A ledger with nothing spent that accepts every record. */
const emptyLedger = {
	spend: () => ({ ok: true, value: { todayUsd: 0, taskUsd: 0 } }) as const,
	record: () => ({ ok: true, value: undefined }) as const,
};

const routedEntries = (logger: ReturnType<typeof createMemoryLogger>) =>
	logger.entries().filter((e) => e.message === "model routed");

describe("the budget fails open", () => {
	test("an unreadable ledger lets the call run and logs a warning", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 0.02, perTaskUsd: null, onBreach: 'stop' }",
		);
		const logger = createMemoryLogger();
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({ MAINA_API_KEY: "test-key" }),
			ledger: {
				...emptyLedger,
				spend: () =>
					({
						ok: false,
						error: { kind: "query_failed", message: "disk I/O error" },
					}) as const,
			},
			logger,
			callModel: async () => ({ text: "ran", tokens: TYPICAL }),
		});
		expect(result.text).toBe("ran");
		expect(result.budgetStop).toBeUndefined();
		const warned = logger
			.entries()
			.filter((e) => e.level === "warn" && e.message.includes("ledger"));
		expect(warned).toHaveLength(1);
	});

	test("a stats store that cannot be opened never blocks the call", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 5, perTaskUsd: null, onBreach: 'stop' }",
		);
		// `.maina` is a file, so `.maina/stats.db` can never be opened.
		const mainaDir = join(root, ".maina");
		writeFileSync(mainaDir, "not a directory");
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir,
			root,
			env: createFakeEnv({ MAINA_API_KEY: "test-key" }),
			callModel: async () => ({ text: "ran", tokens: TYPICAL }),
		});
		expect(result.text).toBe("ran");
		expect(result.budgetStop).toBeUndefined();
	});
});

describe("when no model runs, nothing is logged as routed", () => {
	test("without an API key there is no routing entry and no spend", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 5, perTaskUsd: null, onBreach: 'stop' }",
		);
		const created = createSpendLedger({
			db: createMemoryDb(),
			clock: createFixedClock(AFTERNOON),
		});
		if (!created.ok) throw new Error(created.error.message);
		const logger = createMemoryLogger();
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({}),
			ledger: created.value,
			logger,
			callModel: async () => ({ text: "never", tokens: TYPICAL }),
		});
		expect(result.text).toContain("No API key found");
		expect(routedEntries(logger)).toEqual([]);
		expect(created.value.spend("any")).toEqual({
			ok: true,
			value: { todayUsd: 0, taskUsd: 0 },
		});
	});

	test("host delegation is not logged as routed spend", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 5, perTaskUsd: null, onBreach: 'stop' }",
		);
		const logger = createMemoryLogger();
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({ MAINA_HOST_MODE: "true" }),
			ledger: emptyLedger,
			logger,
		});
		expect(result.model).toBe("host");
		expect(routedEntries(logger)).toEqual([]);
	});

	test("a budget stop is still logged", async () => {
		const root = repoWithBudget(
			"{ dailyUsd: 0.01, perTaskUsd: null, onBreach: 'stop' }",
		);
		const logger = createMemoryLogger();
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({}),
			ledger: emptyLedger,
			logger,
		});
		expect(result.budgetStop).toBeDefined();
		const stops = logger
			.entries()
			.filter((e) => e.message === "model routing stopped by budget");
		expect(stops).toHaveLength(1);
	});
});
