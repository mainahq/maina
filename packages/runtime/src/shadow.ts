/**
 * The System 1 shadow runner (#578). A candidate model answers decisions
 * Maina has already made and acted on, and its answers are logged as
 * shadow records (core `logShadow`) for promotion to read. It never
 * answers a caller: the gate hands it a batch after it has answered the
 * host, and nothing it returns, throws or takes too long over reaches a
 * verdict.
 *
 * - **Async.** `submit` only queues a batch; batches run one at a time, so
 *   the shadow never competes with itself for the CPU the gate needs. With
 *   `maxPending` batches held, new ones are dropped: shadow evidence is
 *   sampled, never a backlog.
 * - **Window cap.** diff.* and spec.* inputs run long (up to 24 windows of
 *   512 tokens, about 8K untrusted tokens), too slow for any synchronous
 *   path, so they only ever run here, and every input is encoded into at
 *   most `SHADOW_MAX_WINDOWS` windows.
 * - **One pass.** A batch's inputs are inferred together (core
 *   `shadowInput` plans them), then read back through core's synchronous
 *   `precomputedBackend`, as the gate's pre-inference does (#572).
 */

import {
	type ClockPort,
	type DecideRequest,
	type DecisionBackend,
	type DecisionLogPorts,
	logShadow,
	type Policy,
	shadowInput,
} from "@mainahq/core";
import { type InferencePort, preInfer } from "./system1";

/** The most windows a shadow input is encoded into (maina-model ADR 0010). */
export const SHADOW_MAX_WINDOWS = 24;

/** Longest a shadow inference may take before it is abandoned. */
const SHADOW_BUDGET_MS = 10_000;

/** Batches held at once, the running one included; the next is dropped. */
const SHADOW_MAX_PENDING = 16;

/** Requests already decided and logged, to shadow together. */
export type ShadowBatch = Readonly<{
	/** Where the primary records are: the shadow records go beside them. */
	log: DecisionLogPorts;
	/** The policy the primary decided with. */
	policy: Policy;
	/** The primary records' `ts`. */
	ts: number;
	/** Each question id names a primary record: `<id>:shadow` pairs with it. */
	requests: readonly DecideRequest[];
	host?: string;
	sessionId?: string;
}>;

export type ShadowRunner = Readonly<{
	/** The candidate backend: a decision it already makes is not shadowed. */
	id: DecisionBackend;
	/** Queues a batch; false when the queue is full and it was dropped. */
	submit: (batch: ShadowBatch) => boolean;
	/** Settles once every queued batch has run. Never rejects. */
	idle: () => Promise<void>;
}>;

type ShadowRunnerOptions = Readonly<{
	model: InferencePort;
	clock: ClockPort;
	budgetMs?: number;
	maxPending?: number;
}>;

/** Infers `batch` in one pass and logs a shadow record per answer. */
async function runBatch(
	options: ShadowRunnerOptions,
	batch: ShadowBatch,
): Promise<void> {
	const { model, clock } = options;
	const { backend } = await preInfer(
		model,
		clock,
		batch.requests.map((r) => shadowInput(batch.policy, r, model.id)),
		options.budgetMs ?? SHADOW_BUDGET_MS,
		{ maxWindows: SHADOW_MAX_WINDOWS },
	);
	for (const request of batch.requests) {
		// A failed answer or write logs nothing for that request: the log is
		// evidence, and a missing shadow record only leaves its primary
		// unpaired.
		logShadow(
			{ clock, shadow: backend, log: batch.log },
			{
				ts: batch.ts,
				request,
				policy: batch.policy,
				host: batch.host,
				sessionId: batch.sessionId,
			},
		);
	}
}

export function createShadowRunner(options: ShadowRunnerOptions): ShadowRunner {
	const maxPending = options.maxPending ?? SHADOW_MAX_PENDING;
	let queued = 0;
	let tail: Promise<void> = Promise.resolve();
	return {
		id: options.model.id,
		submit: (batch) => {
			if (queued >= maxPending || batch.requests.length === 0) return false;
			queued += 1;
			tail = tail
				.then(() => runBatch(options, batch))
				.catch(() => {})
				.finally(() => {
					queued -= 1;
				});
			return true;
		},
		idle: () => tail,
	};
}
