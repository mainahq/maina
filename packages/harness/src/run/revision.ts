/**
 * Bounded revision (FR-HAR-5): the loop of a harness run.
 *
 * The agent attempts the task; the result is reviewed. A failed review gets
 * one revision, with its findings, and a second review. A second failed
 * review always stops the run: it ends with a "stopped" receipt, never a
 * PR. Budgets cover the whole loop, and a breach stops it with a report,
 * as does an agent that fails, stops short or is cancelled. Only a passing
 * review opens a PR, and only when the caller gives a way to open one.
 *
 * Pure but for the injected ports: the agent (`attempt`), the review, the
 * PR and the clock.
 */

import type { Result, RunContext } from "@mainahq/core";
import type { EndEvent, HarnessError } from "../events";
import {
	type Budgets,
	type RunDeps,
	type RunOptions,
	startRun,
} from "../orchestrator";
import {
	type BudgetBreach,
	breachOf,
	describeBreach,
	type RunUsage,
	remainingBudgets,
} from "./budget";

/** Reviews a run gets: the first, and one after its single revision. */
export const MAX_REVIEWS = 2;

export type Review = Readonly<{
	passed: boolean;
	/** One line per finding, as the revision prompt shows them. */
	findings: readonly string[];
}>;

/** How one agent turn ended, and the distinct tool calls it made. */
export type Attempt = Readonly<{ end: EndEvent; toolCalls: number }>;

export type AttemptInput = Readonly<{
	prompt: string;
	/** 0 for the first attempt, 1 for the revision. */
	revision: number;
	/** What is left of the run's budgets. */
	budgets: Budgets;
}>;

export type PrError = Readonly<{ message: string }>;

export type RevisionPorts = Readonly<{
	attempt: (input: AttemptInput) => Promise<Attempt>;
	review: () => Promise<Review>;
	/** Opens the PR once a review passes; without it a passing run opens none. */
	openPr?: () => Promise<Result<string, PrError>>;
	/** Milliseconds, for the wall-clock budget. */
	now: () => number;
}>;

type RunInput = Readonly<{
	task: string;
	context: RunContext;
	budgets: Budgets;
}>;

export type StopReason =
	| "review_failed"
	| "budget_exceeded"
	| "agent_failed"
	| "agent_stopped"
	| "cancelled"
	| "pr_failed";

type ReceiptBase = Readonly<{
	context: RunContext;
	budgets: Budgets;
	attempts: number;
	reviews: readonly Review[];
	usage: RunUsage;
	/** What happened, for a person: the first line says how the run ended. */
	report: string;
}>;

/** How a run ended: `passed` (reviewed, PR opened when asked) or `stopped`. */
export type RunReceipt = ReceiptBase &
	(
		| Readonly<{ status: "passed"; pr?: string }>
		| Readonly<{
				status: "stopped";
				reason: StopReason;
				breach?: BudgetBreach;
				error?: HarnessError | PrError;
		  }>
	);

type Progress = Readonly<{
	input: RunInput;
	attempts: number;
	reviews: readonly Review[];
	usage: RunUsage;
}>;

/** The prompt of the revision: the task, then what the review found. */
function revisionPrompt(task: string, review: Review): string {
	const findings =
		review.findings.length === 0
			? ["(the review gave no details)"]
			: review.findings;
	return [
		task,
		"",
		"A review of your change failed. Fix these findings, then stop:",
		...findings.map((f) => `- ${f}`),
	].join("\n");
}

function summary(progress: Progress): string {
	const { attempts, reviews, usage, input } = progress;
	return `Context: ${input.context} · attempts: ${attempts} · reviews: ${reviews.length} · tool calls: ${usage.toolCalls}`;
}

const STOP_HEADLINES: Readonly<Record<StopReason, string>> = {
	review_failed: `the review failed ${MAX_REVIEWS} times. No PR was opened.`,
	budget_exceeded: "a budget ran out. No PR was opened.",
	agent_failed: "the agent failed. No PR was opened.",
	agent_stopped: "the agent stopped before finishing. No PR was opened.",
	cancelled: "the run was cancelled. No PR was opened.",
	pr_failed: "the review passed, but the PR could not be opened.",
};

function stopped(
	progress: Progress,
	reason: StopReason,
	extra: Readonly<{
		breach?: BudgetBreach;
		error?: HarnessError | PrError;
		detail?: readonly string[];
	}> = {},
): RunReceipt {
	const report = [
		`maina run stopped: ${STOP_HEADLINES[reason]}`,
		...(extra.breach === undefined ? [] : [describeBreach(extra.breach)]),
		...(extra.error === undefined ? [] : [extra.error.message]),
		...(extra.detail ?? []),
		summary(progress),
	].join("\n");
	return {
		status: "stopped",
		reason,
		context: progress.input.context,
		budgets: progress.input.budgets,
		attempts: progress.attempts,
		reviews: progress.reviews,
		usage: progress.usage,
		report,
		...(extra.breach === undefined ? {} : { breach: extra.breach }),
		...(extra.error === undefined ? {} : { error: extra.error }),
	};
}

function passed(progress: Progress, pr: string | undefined): RunReceipt {
	const report = [
		pr === undefined
			? "maina run passed: the review passed."
			: `maina run passed: the review passed and opened ${pr}.`,
		summary(progress),
	].join("\n");
	return {
		status: "passed",
		context: progress.input.context,
		budgets: progress.input.budgets,
		attempts: progress.attempts,
		reviews: progress.reviews,
		usage: progress.usage,
		report,
		...(pr === undefined ? {} : { pr }),
	};
}

/** The breach an orchestrator `budget_exceeded` end stands for. */
function endBreach(
	end: Extract<EndEvent, { state: "budget_exceeded" }>,
	budgets: Budgets,
	usage: RunUsage,
): BudgetBreach {
	return end.budget === "wall_clock"
		? {
				budget: "wall_clock",
				limit: budgets.wallClockMs ?? usage.elapsedMs,
				used: usage.elapsedMs,
			}
		: {
				budget: "tool_calls",
				limit: budgets.maxToolCalls ?? usage.toolCalls,
				used: usage.toolCalls,
			};
}

export async function runWithRevision(
	input: RunInput,
	ports: RevisionPorts,
): Promise<RunReceipt> {
	const started = ports.now();
	let progress: Progress = {
		input,
		attempts: 0,
		reviews: [],
		usage: { elapsedMs: 0, toolCalls: 0 },
	};
	const measure = (toolCalls: number): RunUsage => ({
		elapsedMs: ports.now() - started,
		toolCalls: progress.usage.toolCalls + toolCalls,
	});

	for (let revision = 0; revision < MAX_REVIEWS; revision++) {
		const last = progress.reviews.at(-1);
		const prompt =
			last === undefined ? input.task : revisionPrompt(input.task, last);
		const attempt = await ports.attempt({
			prompt,
			revision,
			budgets: remainingBudgets(input.budgets, progress.usage),
		});
		progress = {
			...progress,
			attempts: progress.attempts + 1,
			usage: measure(attempt.toolCalls),
		};

		const { end } = attempt;
		if (end.state === "budget_exceeded") {
			return stopped(progress, "budget_exceeded", {
				breach: endBreach(end, input.budgets, progress.usage),
			});
		}
		if (end.state === "failed") {
			return stopped(progress, "agent_failed", { error: end.error });
		}
		if (end.state === "cancelled") return stopped(progress, "cancelled");
		if (end.state === "stopped") return stopped(progress, "agent_stopped");
		const breach = breachOf(input.budgets, progress.usage);
		if (breach !== undefined) {
			return stopped(progress, "budget_exceeded", { breach });
		}

		const review = await ports.review();
		progress = {
			...progress,
			reviews: [...progress.reviews, review],
			usage: measure(0),
		};
		if (review.passed) {
			if (ports.openPr === undefined) return passed(progress, undefined);
			const pr = await ports.openPr();
			return pr.ok
				? passed(progress, pr.value)
				: stopped(progress, "pr_failed", { error: pr.error });
		}
	}

	const findings = progress.reviews.at(-1)?.findings ?? [];
	return stopped(progress, "review_failed", {
		detail:
			findings.length === 0
				? []
				: ["Findings from the last review:", ...findings.map((f) => `- ${f}`)],
	});
}

// ── The attempt, over the orchestrator ─────────────────────────────────────

type AttemptBase = Omit<RunOptions, "task" | "budgets">;

/**
 * An `attempt` port that runs one orchestrator turn (`startRun`) with the
 * prompt and the budgets left, and counts the distinct tool calls it saw.
 */
export function orchestratedAttempt(
	base: AttemptBase,
	deps: RunDeps = {},
): RevisionPorts["attempt"] {
	return async ({ prompt, budgets }) => {
		const run = startRun({ ...base, task: prompt, budgets }, deps);
		const calls = new Set<string>();
		for await (const event of run.events) {
			if (event.type === "tool") calls.add(event.call.toolCallId);
		}
		return { end: await run.done, toolCalls: calls.size };
	};
}
