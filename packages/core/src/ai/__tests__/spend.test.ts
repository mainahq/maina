import { describe, expect, test } from "bun:test";
import { createFixedClock, createMemoryDb } from "../../ports/testing";
import { createDbLogger } from "../model-log";
import {
	createSpendLedger,
	currentSpendTask,
	DEFAULT_TIER_PRICES,
	runAsSpendTask,
	type SpendRecord,
	usageCostUsd,
	utcDayStartMs,
} from "../spend";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 2026-09-26T15:30:00Z. */
const AFTERNOON = Date.UTC(2026, 8, 26, 15, 30);

function entry(overrides: Partial<SpendRecord> = {}): SpendRecord {
	return {
		taskId: "run-a",
		task: "review",
		tier: "standard",
		model: "m",
		inputTokens: 1_000,
		outputTokens: 100,
		costUsd: 0.1,
		...overrides,
	};
}

function ledgerAt(startMs: number) {
	const clock = createFixedClock(startMs);
	const db = createMemoryDb();
	const created = createSpendLedger({ db, clock });
	if (!created.ok) throw new Error(created.error.message);
	return { clock, db, ledger: created.value };
}

describe("utcDayStartMs", () => {
	test("is midnight UTC of the same day", () => {
		expect(utcDayStartMs(AFTERNOON)).toBe(Date.UTC(2026, 8, 26));
	});

	test("midnight itself starts its own day", () => {
		const midnight = Date.UTC(2026, 8, 27);
		expect(utcDayStartMs(midnight)).toBe(midnight);
		expect(utcDayStartMs(midnight - 1)).toBe(Date.UTC(2026, 8, 26));
	});
});

describe("usageCostUsd", () => {
	test("is input and output tokens times their per-million prices", () => {
		expect(
			usageCostUsd(
				{ input: 2_000_000, output: 500_000 },
				{ inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
			),
		).toBeCloseTo(6 + 7.5, 10);
	});

	test("the default prices match the routing estimates (8k in, 1k out)", () => {
		const typical = { input: 8_000, output: 1_000 };
		expect(usageCostUsd(typical, DEFAULT_TIER_PRICES.mechanical)).toBeCloseTo(
			0.015,
			10,
		);
		expect(usageCostUsd(typical, DEFAULT_TIER_PRICES.standard)).toBeCloseTo(
			0.04,
			10,
		);
		expect(
			usageCostUsd(typical, DEFAULT_TIER_PRICES.architectural),
		).toBeCloseTo(0.07, 10);
	});
});

describe("createSpendLedger", () => {
	test("an empty ledger has nothing spent", () => {
		const { ledger } = ledgerAt(AFTERNOON);
		expect(ledger.spend("run-a")).toEqual({
			ok: true,
			value: { todayUsd: 0, taskUsd: 0 },
		});
	});

	test("today's spend sums every task's entries since UTC midnight", () => {
		const { ledger } = ledgerAt(AFTERNOON);
		ledger.record(entry({ taskId: "run-a", costUsd: 0.1 }));
		ledger.record(entry({ taskId: "run-b", costUsd: 0.25 }));
		const spent = ledger.spend("run-a");
		expect(spent.ok && spent.value.todayUsd).toBeCloseTo(0.35, 10);
	});

	test("the task's spend counts only that task's entries", () => {
		const { ledger } = ledgerAt(AFTERNOON);
		ledger.record(entry({ taskId: "run-a", costUsd: 0.1 }));
		ledger.record(entry({ taskId: "run-a", costUsd: 0.05 }));
		ledger.record(entry({ taskId: "run-b", costUsd: 0.25 }));
		const spent = ledger.spend("run-a");
		expect(spent.ok && spent.value.taskUsd).toBeCloseTo(0.15, 10);
	});

	test("yesterday's entries drop out of today's spend at UTC midnight", () => {
		const { ledger, clock } = ledgerAt(AFTERNOON);
		ledger.record(entry({ costUsd: 4 }));
		clock.advance(DAY_MS);
		const spent = ledger.spend("run-b");
		expect(spent).toEqual({ ok: true, value: { todayUsd: 0, taskUsd: 0 } });
	});

	test("entries persist in the store the ledger was opened on", () => {
		const { db, clock, ledger } = ledgerAt(AFTERNOON);
		ledger.record(entry({ costUsd: 0.2 }));
		const reopened = createSpendLedger({ db, clock });
		expect(reopened.ok).toBe(true);
		if (!reopened.ok) return;
		const spent = reopened.value.spend("run-a");
		expect(spent.ok && spent.value.todayUsd).toBeCloseTo(0.2, 10);
		const rows = db.all(
			"SELECT task, tier, model, input_tokens, output_tokens, ts FROM model_spend",
		);
		expect(rows.ok && rows.value).toEqual([
			{
				task: "review",
				tier: "standard",
				model: "m",
				input_tokens: 1_000,
				output_tokens: 100,
				ts: AFTERNOON,
			},
		]);
	});

	test("a failing store comes back as an error, not a throw", () => {
		const clock = createFixedClock(AFTERNOON);
		const created = createSpendLedger({
			db: {
				run: () => ({
					ok: false,
					error: { kind: "query_failed", message: "read-only" },
				}),
				all: () => ({ ok: true, value: [] }),
			},
			clock,
		});
		expect(created.ok).toBe(false);
	});
});

describe("spend tasks", () => {
	test("calls outside any task share the process task id", () => {
		expect(currentSpendTask()).toBe(currentSpendTask());
	});

	test("runAsSpendTask gives the work its own task id, even across awaits", async () => {
		const outside = currentSpendTask();
		const seen = await runAsSpendTask(async () => {
			const before = currentSpendTask();
			await Promise.resolve();
			return { before, after: currentSpendTask() };
		});
		expect(seen.before).not.toBe(outside);
		expect(seen.after).toBe(seen.before);
		expect(currentSpendTask()).toBe(outside);
	});

	test("each runAsSpendTask call is a separate task", async () => {
		const first = await runAsSpendTask(async () => currentSpendTask());
		const second = await runAsSpendTask(async () => currentSpendTask());
		expect(first).not.toBe(second);
	});
});

describe("createDbLogger", () => {
	test("keeps every entry with its level, fields and time", () => {
		const db = createMemoryDb();
		const clock = createFixedClock(AFTERNOON);
		const created = createDbLogger({ db, clock });
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		created.value.info("model routed", { tier: "standard", savingsUsd: 0 });
		created.value.warn("model routing stopped by budget");
		const rows = db.all(
			"SELECT level, message, fields, ts FROM model_log ORDER BY seq",
		);
		expect(rows.ok && rows.value).toEqual([
			{
				level: "info",
				message: "model routed",
				fields: '{"tier":"standard","savingsUsd":0}',
				ts: AFTERNOON,
			},
			{
				level: "warn",
				message: "model routing stopped by budget",
				fields: null,
				ts: AFTERNOON,
			},
		]);
	});

	test("fields that cannot be serialised do not throw", () => {
		const db = createMemoryDb();
		const created = createDbLogger({ db, clock: createFixedClock() });
		if (!created.ok) throw new Error(created.error.message);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => created.value.info("x", cyclic)).not.toThrow();
	});
});
