/**
 * ACP client orchestrator (FR-HAR-1).
 *
 * `startRun` spawns an ACP agent in the workspace root, runs one prompt turn
 * with it and streams what it does as normalised events: the session, its
 * messages, every tool call (with the core gate's `GateEvent`s), diffs,
 * permission requests with the policy's verdict, and one final `end`.
 *
 * A run always ends, and always cleans up: completed, stopped, cancelled
 * (`Run.cancel()`), over budget, or failed (spawn error, protocol version
 * mismatch, agent died). Whatever the ending, the agent process is stopped
 * (TERM, then KILL) before `end` is emitted.
 */

import type { StopReason } from "@agentclientprotocol/sdk";
import type { Result } from "@mainahq/core";
import type {
	BudgetKind,
	EndEvent,
	HarnessError,
	HarnessEvent,
} from "./events";
import { type PermissionPolicy, runSession } from "./session";
import { type AgentSpec, type SpawnAgent, spawnAgent } from "./worker";

export type { PermissionPolicy } from "./session";

/** Limits a run is cancelled at; unset means unlimited. */
export type Budgets = Readonly<{
	/** Milliseconds from spawn to end. */
	wallClockMs?: number;
	/** Distinct tool calls the agent may make; the next one cancels the run. */
	maxToolCalls?: number;
}>;

export type RunOptions = Readonly<{
	agent: AgentSpec;
	/** The prompt for the agent's turn. */
	task: string;
	/** Absolute workspace root: the agent's cwd and the session's `cwd`. */
	root: string;
	policy: PermissionPolicy;
	budgets?: Budgets;
}>;

export type RunDeps = Readonly<{
	spawn?: SpawnAgent;
	/** How long a cancelled agent gets to answer `session/cancel`. */
	cancelGraceMs?: number;
	/** How long a stopped agent gets between SIGTERM and SIGKILL. */
	killGraceMs?: number;
}>;

export type Run = Readonly<{
	/** Every event of the run, ending with `end`. Iterate it once. */
	events: AsyncIterable<HarnessEvent>;
	/** Resolves with the `end` event. */
	done: Promise<EndEvent>;
	/** Cancels the run; resolves once the agent process is gone. */
	cancel: () => Promise<void>;
}>;

const CANCEL_GRACE_MS = 2000;
const KILL_GRACE_MS = 2000;

type StopCause = "cancelled" | BudgetKind;

/** A single-consumer async queue: pushes buffer until pulled. */
function channel<T>(): Readonly<{
	push: (value: T) => void;
	close: () => void;
	iterable: AsyncIterable<T>;
}> {
	const buffer: T[] = [];
	let closed = false;
	let wake: (() => void) | undefined;
	const notify = (): void => {
		wake?.();
		wake = undefined;
	};
	return {
		push: (value) => {
			if (closed) return;
			buffer.push(value);
			notify();
		},
		close: () => {
			closed = true;
			notify();
		},
		iterable: {
			async *[Symbol.asyncIterator]() {
				for (;;) {
					const next = buffer.shift();
					if (next !== undefined) {
						yield next;
						continue;
					}
					if (closed) return;
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			},
		},
	};
}

/** Waits for `promise`, but no longer than `ms`. */
async function within(promise: Promise<void>, ms: number): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, ms);
	});
	await Promise.race([promise, timeout]);
	clearTimeout(timer);
}

const aborted = (signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
	});

function endOf(
	cause: StopCause | undefined,
	outcome: Result<StopReason, HarnessError> | undefined,
	stderr: string,
): EndEvent {
	const stopReason = outcome?.ok === true ? { stopReason: outcome.value } : {};
	if (cause === "cancelled") {
		return { type: "end", state: "cancelled", ...stopReason };
	}
	if (cause !== undefined) {
		return {
			type: "end",
			state: "budget_exceeded",
			budget: cause,
			...stopReason,
		};
	}
	if (outcome === undefined) {
		return {
			type: "end",
			state: "failed",
			error: { code: "agent_exited", message: "agent stopped answering" },
		};
	}
	if (!outcome.ok) {
		const { error } = outcome;
		const message =
			error.code === "agent_exited" && stderr !== ""
				? `${error.message}\n${stderr}`
				: error.message;
		return { type: "end", state: "failed", error: { ...error, message } };
	}
	return {
		type: "end",
		state: outcome.value === "end_turn" ? "completed" : "stopped",
		stopReason: outcome.value,
	};
}

export function startRun(options: RunOptions, deps: RunDeps = {}): Run {
	const events = channel<HarnessEvent>();
	const controller = new AbortController();
	let cause: StopCause | undefined;
	let finished = false;
	const stop = (why: StopCause): void => {
		if (finished || controller.signal.aborted) return;
		cause = why;
		controller.abort(why);
	};
	const cancelGraceMs = deps.cancelGraceMs ?? CANCEL_GRACE_MS;
	const killGraceMs = deps.killGraceMs ?? KILL_GRACE_MS;
	const { budgets = {} } = options;

	let wallClock: ReturnType<typeof setTimeout> | undefined;
	const finish = (end: EndEvent): EndEvent => {
		finished = true;
		clearTimeout(wallClock);
		events.push(end);
		events.close();
		return end;
	};

	const done = (async (): Promise<EndEvent> => {
		const spawned = (deps.spawn ?? spawnAgent)(options.agent, options.root);
		if (!spawned.ok)
			return finish({ type: "end", state: "failed", error: spawned.error });
		const child = spawned.value;

		if (budgets.wallClockMs !== undefined) {
			wallClock = setTimeout(() => stop("wall_clock"), budgets.wallClockMs);
		}
		const toolCalls = new Set<string>();
		const count = (toolCallId: string): void => {
			toolCalls.add(toolCallId);
			if (
				budgets.maxToolCalls !== undefined &&
				toolCalls.size > budgets.maxToolCalls
			) {
				stop("tool_calls");
			}
		};
		const emit = (event: HarnessEvent): void => {
			events.push(event);
			if (event.type === "tool") count(event.call.toolCallId);
		};
		// A permission request counts its call too, before it is judged: an
		// agent that asks about a call before reporting it must not get a
		// call past the budget allowed (the aborted session answers cancelled).
		const policy: PermissionPolicy = (request) => {
			count(request.toolCallId);
			return controller.signal.aborted ? "deny" : options.policy(request);
		};

		let outcome: Result<StopReason, HarnessError> | undefined;
		const session = runSession(child, {
			agent: options.agent.name,
			task: options.task,
			root: options.root,
			policy,
			emit,
			signal: controller.signal,
		}).then(
			(result) => {
				outcome = result;
			},
			// Never expected; left undefined, the run still ends (failed).
			() => undefined,
		);

		await Promise.race([session, aborted(controller.signal)]);
		// The turn is over (or already stopped): a cancel or budget that lands
		// during teardown must not relabel how it ended.
		finished = true;
		// Cancelled: give the agent a moment to answer `session/cancel`.
		if (controller.signal.aborted) {
			await within(session, cancelGraceMs);
		}
		await child.stop(killGraceMs);
		// With the agent gone the connection closes and the session settles.
		await within(session, killGraceMs);
		return finish(endOf(cause, outcome, child.stderrTail()));
	})();

	return {
		events: events.iterable,
		done,
		cancel: async () => {
			stop("cancelled");
			await done;
		},
	};
}
