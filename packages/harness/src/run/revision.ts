/**
 * Bounded revision (FR-HAR-5): the loop of a harness run.
 *
 * The agent attempts the task; the result is reviewed. A failed review gets
 * one revision, with its findings, and a second review. A second failed
 * review always stops the run: it ends with a "stopped" receipt, never a
 * PR. Budgets cover the whole loop, and a breach stops it with a report,
 * as does an agent that fails, stops short or is cancelled. Only a passing
 * review opens a PR, and only when the caller gives a way to open one. A
 * port that throws ends the run with a "stopped" receipt too.
 *
 * Pure but for the injected ports: the agent (`attempt`), the review, the
 * PR and the clock.
 *
 * Run board control (#594, cloud FR-RUN-1, FR-RUN-3, FR-RUN-4): with a
 * `control` port the run reports `run.started`, a `run.step` per gated tool
 * call and `run.finished` under its run id, and obeys the board:
 *
 * - A stop halts the worker (the attempt's `signal`) and ends the run
 *   `stopped` with a report (`remote_stop`), whenever it arrives.
 * - After a failed first review the run waits a bounded time for the
 *   board's answer to its revision question: a revision grant starts the
 *   one revision, a stop (the board's "stopped with report") ends the run.
 *   With no answer in time the local rule stands and the revision runs, so
 *   a board that never answers never blocks a run. Either way the run
 *   takes one revision at most: a second grant is refused.
 */

import type { Result, RunContext } from "@mainahq/core";
import {
	type EndEvent,
	type HarnessError,
	type HarnessEvent,
	type RunLifecycleEvent,
	type RunOutcome,
	runStepOf,
} from "../events";
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
import type { RunSource } from "./context";

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
	/** Aborted by a stop from the run board: the attempt stops its worker. */
	signal?: AbortSignal;
	/** Sees every event of the attempt, for the run's steps. */
	onEvent?: (event: HarnessEvent) => void;
}>;

export type PrError = Readonly<{ message: string }>;

/** A port that threw instead of answering. */
type PortError = Readonly<{ message: string }>;

/** The run board's answer to a run's revision question. */
type RevisionAnswer =
	| Readonly<{ kind: "grant"; grantId: string }>
	| Readonly<{ kind: "stop" }>
	/** No answer in time: the local rule (one revision) stands. */
	| Readonly<{ kind: "local" }>;

/** A run the run board can see and steer (`createRunControl`). */
export type RunControl = Readonly<{
	runId: string;
	source: RunSource;
	/** The worker, as `maina run --agent` names it. */
	agent: string;
	/** Where the run's lifecycle goes (the runtime's Link uplink). */
	emit: (event: RunLifecycleEvent) => void;
	/** Aborted once the board stops the run. */
	signal: AbortSignal;
	/** The stop's reason, once stopped, when the board gave one. */
	stopReason: () => string | undefined;
	/** Waits at most `limitMs` (and the control's own wait) for the board's answer. */
	awaitRevision: (limitMs?: number) => Promise<RevisionAnswer>;
}>;

export type RevisionPorts = Readonly<{
	attempt: (input: AttemptInput) => Promise<Attempt>;
	review: () => Promise<Review>;
	/** Opens the PR once a review passes; without it a passing run opens none. */
	openPr?: () => Promise<Result<string, PrError>>;
	/** Milliseconds, for the wall-clock budget. */
	now: () => number;
	/** The run board's view of the run and its steering; none by default. */
	control?: RunControl;
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
	| "review_error"
	| "pr_failed"
	/** The run board stopped the run (#594). */
	| "remote_stop";

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
				error?: HarnessError | PrError | PortError;
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
	review_error: "the review could not run. No PR was opened.",
	pr_failed: "the review passed, but the PR could not be opened.",
	remote_stop: "the run was stopped from the run board. No PR was opened.",
};

/** The stop reason of the board's answer "stopped with report" (cloud Task 8.3). */
const STOPPED_WITH_REPORT = "stopped_with_report";

function stopped(
	progress: Progress,
	reason: StopReason,
	extra: Readonly<{
		breach?: BudgetBreach;
		error?: HarnessError | PrError | PortError;
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

/** `port()`, with a throw turned into an error value. */
async function settle<T>(
	port: () => Promise<T>,
): Promise<Result<T, PortError>> {
	try {
		return { ok: true, value: await port() };
	} catch (e) {
		return {
			ok: false,
			error: { message: e instanceof Error ? e.message : String(e) },
		};
	}
}

/** The last review's findings, as a report's lines. */
function findingLines(progress: Progress): readonly string[] {
	const findings = progress.reviews.at(-1)?.findings ?? [];
	return findings.length === 0
		? []
		: ["Findings from the last review:", ...findings.map((f) => `- ${f}`)];
}

/** The run the board stopped: a stopped receipt with the board's reason. */
function remoteStopped(progress: Progress, control: RunControl): RunReceipt {
	const reason = control.stopReason();
	const why =
		reason === STOPPED_WITH_REPORT
			? "The run board declined the revision: stopped with report."
			: reason === undefined
				? "The run board stopped it."
				: `The run board stopped it (${reason}).`;
	return stopped(progress, "remote_stop", {
		detail: [why, ...findingLines(progress)],
	});
}

/** The one revision loop (FR-HAR-5); `control` adds the board's steering. */
async function revise(
	input: RunInput,
	ports: RevisionPorts,
	onEvent: ((event: HarnessEvent) => void) | undefined,
): Promise<RunReceipt> {
	const { control } = ports;
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
	const halted = (): boolean => control?.signal.aborted === true;

	for (let revision = 0; revision < MAX_REVIEWS; revision++) {
		if (control !== undefined && halted()) {
			return remoteStopped(progress, control);
		}
		const last = progress.reviews.at(-1);
		const prompt =
			last === undefined ? input.task : revisionPrompt(input.task, last);
		const attempt = await settle(() =>
			ports.attempt({
				prompt,
				revision,
				budgets: remainingBudgets(input.budgets, progress.usage),
				...(control === undefined ? {} : { signal: control.signal }),
				...(onEvent === undefined ? {} : { onEvent }),
			}),
		);
		progress = {
			...progress,
			attempts: progress.attempts + 1,
			usage: measure(attempt.ok ? attempt.value.toolCalls : 0),
		};
		// A worker the board stopped ends however it ends: the stop is why.
		if (control !== undefined && halted()) {
			return remoteStopped(progress, control);
		}
		if (!attempt.ok) {
			return stopped(progress, "agent_failed", { error: attempt.error });
		}

		const { end } = attempt.value;
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

		const reviewed = await settle(ports.review);
		if (!reviewed.ok) {
			return stopped({ ...progress, usage: measure(0) }, "review_error", {
				error: reviewed.error,
			});
		}
		const review = reviewed.value;
		progress = {
			...progress,
			reviews: [...progress.reviews, review],
			usage: measure(0),
		};
		if (control !== undefined && halted()) {
			return remoteStopped(progress, control);
		}
		// The review counts against the wall clock: past it, the run neither
		// opens a PR nor starts a revision with nothing left.
		const spent = breachOf(input.budgets, progress.usage);
		if (spent !== undefined) {
			return stopped(progress, "budget_exceeded", { breach: spent });
		}
		if (review.passed) {
			const { openPr } = ports;
			if (openPr === undefined) return passed(progress, undefined);
			const pr = await settle(openPr);
			const opened = pr.ok ? pr.value : pr;
			return opened.ok
				? passed(progress, opened.value)
				: stopped(progress, "pr_failed", { error: opened.error });
		}
		if (control !== undefined && revision < MAX_REVIEWS - 1) {
			// The revision question goes to the board, within the wall clock left.
			const left = remainingBudgets(input.budgets, progress.usage).wallClockMs;
			const answer = await settle(() => control.awaitRevision(left));
			progress = { ...progress, usage: measure(0) };
			if (halted() || (answer.ok && answer.value.kind === "stop")) {
				return remoteStopped(progress, control);
			}
			const waited = breachOf(input.budgets, progress.usage);
			if (waited !== undefined) {
				return stopped(progress, "budget_exceeded", { breach: waited });
			}
		}
	}

	return stopped(progress, "review_failed", {
		detail: findingLines(progress),
	});
}

/** How a run with `receipt` ended, as the run board shows it. */
export function runOutcome(receipt: RunReceipt): RunOutcome {
	if (receipt.status === "passed") return "succeeded";
	switch (receipt.reason) {
		case "remote_stop":
		case "budget_exceeded":
			return "stopped";
		case "cancelled":
			return "cancelled";
		case "review_failed":
		case "agent_failed":
		case "agent_stopped":
		case "review_error":
		case "pr_failed":
			return "failed";
		default: {
			const unknown: never = receipt.reason;
			return unknown;
		}
	}
}

export async function runWithRevision(
	input: RunInput,
	ports: RevisionPorts,
): Promise<RunReceipt> {
	const { control } = ports;
	if (control === undefined) return revise(input, ports, undefined);

	const { runId } = control;
	const started = ports.now();
	let steps = 0;
	// The board's view is evidence: a lost event never ends the run.
	const send = (event: RunLifecycleEvent): void => {
		try {
			control.emit(event);
		} catch {
			// The runtime is gone or refused it; the run goes on.
		}
	};
	send({
		type: "run.started",
		runId,
		source: control.source,
		agent: control.agent,
	});
	const receipt = await revise(input, ports, (event) => {
		const step = runStepOf(event);
		if (step === null) return;
		steps++;
		send({ type: "run.step", runId, step: steps, ...step });
	});
	send({
		type: "run.finished",
		runId,
		outcome: runOutcome(receipt),
		durationMs: Math.max(0, ports.now() - started),
		steps,
	});
	return receipt;
}

type RunControlInput = Readonly<{
	runId: string;
	source: RunSource;
	agent: string;
	emit: RunControl["emit"];
	/**
	 * How long a failed review waits for the board's revision answer before
	 * the local rule (one revision) stands; 0 (the default) does not wait,
	 * but a grant that already arrived is used.
	 */
	revisionWaitMs?: number;
}>;

/** What the runtime's control channel drives (`RunControlHandle` there). */
type RemoteRunHandle = Readonly<{
	/** Stops the run; the first stop wins. */
	stop: (reason?: string) => void;
	/** The board grants the one revision; false once the run had it (or will). */
	grantRevision: (grantId: string) => boolean;
}>;

/**
 * A run the board can steer: `control` goes to `runWithRevision`, `handle`
 * to the runtime's control channel, which calls it for the run's verified
 * control messages.
 */
export function createRunControl(input: RunControlInput): Readonly<{
	control: RunControl;
	handle: RemoteRunHandle;
}> {
	const controller = new AbortController();
	let reason: string | undefined;
	let grant: string | undefined;
	/** The revision question was answered (the revision runs or ran). */
	let answered = false;
	let wake: ((answer: RevisionAnswer) => void) | undefined;

	const handle: RemoteRunHandle = {
		stop: (why) => {
			if (controller.signal.aborted) return;
			reason = why;
			controller.abort();
			wake?.({ kind: "stop" });
		},
		grantRevision: (grantId) => {
			// A stopped run, or one that had its revision, takes no grant.
			if (grant !== undefined || answered || controller.signal.aborted) {
				return false;
			}
			grant = grantId;
			wake?.({ kind: "grant", grantId });
			return true;
		},
	};

	const control: RunControl = {
		runId: input.runId,
		source: input.source,
		agent: input.agent,
		emit: input.emit,
		signal: controller.signal,
		stopReason: () => reason,
		awaitRevision: (limitMs) => {
			if (controller.signal.aborted) return Promise.resolve({ kind: "stop" });
			const waitMs = Math.max(
				0,
				Math.min(
					input.revisionWaitMs ?? 0,
					limitMs ?? Number.POSITIVE_INFINITY,
				),
			);
			return new Promise<RevisionAnswer>((resolve) => {
				const settle = (answer: RevisionAnswer): void => {
					clearTimeout(timer);
					wake = undefined;
					if (answer.kind !== "stop") answered = true;
					resolve(answer);
				};
				const timer = setTimeout(() => settle({ kind: "local" }), waitMs);
				wake = settle;
				if (grant !== undefined) settle({ kind: "grant", grantId: grant });
			});
		},
	};
	return { control, handle };
}

// ── The attempt, over the orchestrator ─────────────────────────────────────

type AttemptBase = Omit<RunOptions, "task" | "budgets" | "signal">;

/**
 * An `attempt` port that runs one orchestrator turn (`startRun`) with the
 * prompt and the budgets left, and counts the distinct tool calls it saw.
 * The attempt's `signal` stops the worker; `onEvent` sees every event.
 */
export function orchestratedAttempt(
	base: AttemptBase,
	deps: RunDeps = {},
): RevisionPorts["attempt"] {
	return async ({ prompt, budgets, signal, onEvent }) => {
		const run = startRun(
			{
				...base,
				task: prompt,
				budgets,
				...(signal === undefined ? {} : { signal }),
			},
			deps,
		);
		const calls = new Set<string>();
		for await (const event of run.events) {
			if (event.type === "tool") calls.add(event.call.toolCallId);
			onEvent?.(event);
		}
		return { end: await run.done, toolCalls: calls.size };
	};
}
