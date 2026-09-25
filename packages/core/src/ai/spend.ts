/**
 * The spend ledger behind the enforced budget (#463). Every model call that
 * `generate()` makes is recorded with its token usage and cost; `spend`
 * reads back what has been spent in the current UTC day and by the running
 * task, which `routeTask` holds to `budget.dailyUsd` / `budget.perTaskUsd`.
 *
 * A task is one running command. A CLI process is one command, so calls
 * outside any scope share the process's task id; a long-lived host (the
 * MCP server) runs each tool call in its own task with `runAsSpendTask`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { BudgetSpend } from "../config/budget";
import type { Result } from "../db/index";
import type { ClockPort } from "../ports/clock";
import type { DbError, DbPort } from "../ports/db";
import type { ModelTier } from "./tiers";

/** Token usage a provider reported for one call. */
type TokenUsage = Readonly<{ input: number; output: number }>;

/** List price of a model, in US dollars per million tokens. */
type TokenPrice = Readonly<{
	inputUsdPerMTok: number;
	outputUsdPerMTok: number;
}>;

/**
 * Per-tier list prices for the default models. At the typical 8k input and
 * 1k output tokens they give the routing estimates in `routing.ts`.
 */
export const DEFAULT_TIER_PRICES: Readonly<Record<ModelTier, TokenPrice>> = {
	mechanical: { inputUsdPerMTok: 1.25, outputUsdPerMTok: 5 },
	standard: { inputUsdPerMTok: 3, outputUsdPerMTok: 16 },
	architectural: { inputUsdPerMTok: 5, outputUsdPerMTok: 30 },
};

const MTOK = 1_000_000;

/** What `usage` costs at `price`. */
export function usageCostUsd(usage: TokenUsage, price: TokenPrice): number {
	return (
		(usage.input * price.inputUsdPerMTok +
			usage.output * price.outputUsdPerMTok) /
		MTOK
	);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the day `nowMs` falls in. */
export function utcDayStartMs(nowMs: number): number {
	return Math.floor(nowMs / DAY_MS) * DAY_MS;
}

// ── tasks ───────────────────────────────────────────────────────────────────

const taskScope = new AsyncLocalStorage<string>();
const PROCESS_TASK_ID = randomUUID();

/** The running task's id: the innermost `runAsSpendTask`, else the process's. */
export function currentSpendTask(): string {
	return taskScope.getStore() ?? PROCESS_TASK_ID;
}

/** Runs `work` as its own task, so the per-task cap counts only its calls. */
export function runAsSpendTask<T>(work: () => T): T {
	return taskScope.run(randomUUID(), work);
}

// ── ledger ──────────────────────────────────────────────────────────────────

/** One model call's spend. */
export type SpendRecord = Readonly<{
	taskId: string;
	task: string;
	tier: ModelTier;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}>;

export type SpendLedgerPort = Readonly<{
	/** Spent in the current UTC day (every task) and by `taskId`. */
	spend: (taskId: string) => Result<BudgetSpend, DbError>;
	/** Appends one call's spend, stamped with the ledger's clock. */
	record: (entry: SpendRecord) => Result<void, DbError>;
}>;

const SPEND_LEDGER_MIGRATION: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS model_spend (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		ts INTEGER NOT NULL,
		task_id TEXT NOT NULL,
		task TEXT NOT NULL,
		tier TEXT NOT NULL,
		model TEXT NOT NULL,
		input_tokens INTEGER NOT NULL,
		output_tokens INTEGER NOT NULL,
		cost_usd REAL NOT NULL
	)`,
	"CREATE INDEX IF NOT EXISTS idx_model_spend_ts ON model_spend(ts)",
	"CREATE INDEX IF NOT EXISTS idx_model_spend_task ON model_spend(task_id)",
];

/** Runs each statement in order, stopping at the first failure. */
export function migrate(
	db: DbPort,
	statements: readonly string[],
): Result<void, DbError> {
	for (const statement of statements) {
		const applied = db.run(statement);
		if (!applied.ok) return applied;
	}
	return { ok: true, value: undefined };
}

function sumOf(
	db: DbPort,
	where: string,
	param: string | number,
): Result<number, DbError> {
	const rows = db.all(
		`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM model_spend WHERE ${where}`,
		[param],
	);
	if (!rows.ok) return rows;
	return { ok: true, value: Number(rows.value[0]?.total ?? 0) };
}

/** The ledger over `db`, creating its table on first use. */
export function createSpendLedger(
	ports: Readonly<{ db: DbPort; clock: ClockPort }>,
): Result<SpendLedgerPort, DbError> {
	const { db, clock } = ports;
	const migrated = migrate(db, SPEND_LEDGER_MIGRATION);
	if (!migrated.ok) return migrated;
	return {
		ok: true,
		value: {
			spend: (taskId) => {
				const today = sumOf(db, "ts >= ?", utcDayStartMs(clock.now()));
				if (!today.ok) return today;
				const task = sumOf(db, "task_id = ?", taskId);
				if (!task.ok) return task;
				return {
					ok: true,
					value: { todayUsd: today.value, taskUsd: task.value },
				};
			},
			record: (entry) =>
				db.run(
					`INSERT INTO model_spend
						(ts, task_id, task, tier, model, input_tokens, output_tokens, cost_usd)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						clock.now(),
						entry.taskId,
						entry.task,
						entry.tier,
						entry.model,
						entry.inputTokens,
						entry.outputTokens,
						entry.costUsd,
					],
				),
		},
	};
}
