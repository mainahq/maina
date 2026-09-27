/**
 * Fail-closed hook client (FR-GATE-1, spec §6.1 rule 2; ADR 0044).
 *
 * `evaluate` asks the resident runtime to evaluate a gate event within
 * `timeoutMs`. When no runtime answers it spawns one (single flight) and
 * retries once within the same budget; a runtime of another version is
 * restarted the same way. Whenever the runtime still cannot answer (spawn
 * failed, timeout, crash, bad response, handler error) the client evaluates
 * the injected rules-only `fallback` in process and returns its decision
 * flagged `degraded`. A runtime answer carries the runtime's own `degraded`
 * flag and decision ids (#454). A degraded result, from either source, is
 * never `allow`.
 *
 * The runtime never gets the whole budget: the last part of it is kept for
 * the fallback, which on a cold start has to load the bash grammar before
 * it can decide (#564). While the client waits for a runtime it has to
 * start, or for one slow to answer, `warmFallback` starts that loading, so
 * a runtime that never answers still leaves a fallback that can deny.
 */

import {
	type DegradedCause,
	failClosed,
	type GateDecision,
	type GateEvaluator,
	type GateEvent,
	type GateResult,
	parseGateDecision,
} from "../gate";
import { createRequest, sendRequest } from "../ipc";
import { ensureRuntime, type SpawnRuntime } from "../lifecycle";
import { type Endpoint, ensureEndpointDirs } from "../registry";

type HookClientConfig = Readonly<{
	endpoint: Endpoint;
	/** This client's version; the runtime must match it. */
	version: string;
	spawn: SpawnRuntime;
	/**
	 * Rules-only evaluation used when the runtime cannot answer. It runs in
	 * this process, so it must be bounded: the time budget can cut off an
	 * async fallback, but not a synchronous one that never returns.
	 */
	fallback: GateEvaluator;
	/**
	 * Starts loading what `fallback` needs (the bash grammar) without
	 * evaluating anything. Called at most once per evaluation, only when the
	 * runtime has to be started or is slow to answer; errors are ignored.
	 */
	warmFallback?: () => void;
}>;

type EvaluateOptions = Readonly<{ timeoutMs: number }>;

type HookClient = Readonly<{
	evaluate: (event: GateEvent, options: EvaluateOptions) => Promise<GateResult>;
}>;

/** Extra time the in-process fallback gets once the budget is spent. */
const FALLBACK_GRACE_MS = 50;

/**
 * The part of the budget kept for the fallback, at most a third of it: a
 * cold fallback loads the bash grammar first, a few hundred ms (#564).
 */
const FALLBACK_RESERVE_MS = 1_000;

/** A runtime that has not answered by then is slow: warm the fallback. */
const WARM_AFTER_MS = 500;

const UNUSABLE: GateDecision = {
	verdict: "ask",
	reason: "rules-only evaluation failed",
	decisionIds: [],
	degraded: true,
};

/** Runs the fallback, bounded in time; any failure is `UNUSABLE`. */
async function runFallback(
	fallback: GateEvaluator,
	event: GateEvent,
	budgetMs: number,
): Promise<GateDecision> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<GateDecision>((resolve) => {
		timer = setTimeout(() => resolve(UNUSABLE), budgetMs);
	});
	try {
		const decided = Promise.resolve()
			.then(() => fallback(event))
			.then((value) => parseGateDecision(value) ?? UNUSABLE)
			.catch(() => UNUSABLE);
		return await Promise.race([decided, late]);
	} finally {
		clearTimeout(timer);
	}
}

/** `warm` at most once; a throw is ignored (the fallback then loads cold). */
function once(warm: (() => void) | undefined): () => void {
	let warmed = warm === undefined;
	return () => {
		if (warmed) return;
		warmed = true;
		try {
			warm?.();
		} catch {
			// The fallback loads what it needs itself, or fails closed.
		}
	};
}

export function createHookClient(config: HookClientConfig): HookClient {
	const { endpoint, version, spawn, fallback, warmFallback } = config;

	const degrade = async (
		event: GateEvent,
		cause: DegradedCause,
		deadline: number,
	): Promise<GateResult> => {
		const budget = Math.max(0, deadline - Date.now()) + FALLBACK_GRACE_MS;
		const decision = failClosed(await runFallback(fallback, event, budget));
		return {
			verdict: decision.verdict,
			reason: `${decision.reason} (maina runtime unavailable: ${cause})`,
			decisionIds: decision.decisionIds,
			degraded: true,
			source: "fallback",
			degradedCause: cause,
		};
	};

	/**
	 * Asks the runtime until `runtimeDeadline`; a degraded answer runs the
	 * fallback until `deadline`.
	 */
	const evaluateRuntime = async (
		event: GateEvent,
		runtimeDeadline: number,
		deadline: number,
		warm: () => void,
	): Promise<GateResult> => {
		let recovered = false;
		for (;;) {
			const remaining = runtimeDeadline - Date.now();
			if (remaining <= 0) return degrade(event, "timeout", deadline);
			const sent = await sendRequest(
				endpoint.address,
				createRequest("hook.evaluate", event, version),
				remaining,
			);
			const otherVersion =
				sent.ok &&
				(sent.value.runtimeVersion !== version ||
					(!sent.value.ok && sent.value.error.code === "version_mismatch"));
			const needsRuntime = sent.ok
				? otherVersion
				: sent.error.kind === "connect_failed";
			if (needsRuntime && !recovered) {
				recovered = true;
				warm();
				const up = await ensureRuntime({
					endpoint,
					version,
					spawn,
					deadline: runtimeDeadline,
				});
				if (!up.ok) return degrade(event, up.error.kind, deadline);
				continue;
			}
			if (!sent.ok) return degrade(event, sent.error.kind, deadline);
			if (otherVersion) return degrade(event, "version_mismatch", deadline);
			const response = sent.value;
			if (!response.ok) return degrade(event, response.error.code, deadline);
			const decision = parseGateDecision(response.result);
			if (decision === null) return degrade(event, "bad_response", deadline);
			// A degraded gate never allows, even when the runtime says so.
			const settled = decision.degraded ? failClosed(decision) : decision;
			return { ...settled, source: "runtime" };
		}
	};

	/** Never rejects: an unexpected throw (a misbehaving port) degrades too. */
	const evaluate = async (
		event: GateEvent,
		{ timeoutMs }: EvaluateOptions,
	): Promise<GateResult> => {
		const deadline = Date.now() + timeoutMs;
		const reserve = Math.min(FALLBACK_RESERVE_MS, Math.floor(timeoutMs / 3));
		const warm = once(warmFallback);
		const slow = setTimeout(warm, WARM_AFTER_MS);
		try {
			// Only a runtime behind a private socket dir is trusted to answer.
			const dirs = ensureEndpointDirs(endpoint, process.platform);
			if (!dirs.ok) return degrade(event, "insecure_endpoint", deadline);
			return await evaluateRuntime(event, deadline - reserve, deadline, warm);
		} catch {
			return degrade(event, "client_error", deadline);
		} finally {
			clearTimeout(slow);
		}
	};

	return { evaluate };
}
