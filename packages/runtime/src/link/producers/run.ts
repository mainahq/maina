/**
 * Run events (#594, cloud plan Task 8.4, FR-RUN-1, FR-RUN-4): `run.started`,
 * `run.step` and `run.finished`, the facts the run board and a run's replay
 * timeline are built from.
 *
 * A run has one id from its start to its end, and every event of the run
 * carries it. Runs come from three sources (spec FR-RUN-1):
 *
 * - `plugin`: a host session maina is a plugin in (Claude Code, Codex,
 *   Cursor). The resident runtime sees the session's hook events: a
 *   session start opens the run, each gated tool call is a step with the
 *   gate's verdict, and the session's stop ends it (`createPluginRuns` in
 *   `run-events.ts`).
 * - `maina-run`: a `maina run` worker. The harness sends each fact over
 *   the runtime's IPC (`run.event`) and `parseRunFact` reads it.
 * - `ci`: either of them in a CI job (`CI` set).
 *
 * Metadata only: the run id, the agent and host as labels, the repo and
 * branch as salted hashes, the tool class, the verdict and counts. A value
 * of another shape (a name, a path, a command) is never sent.
 *
 * The pinned v1 event schema has no `source` field yet (the cloud derives
 * `ci` from a CI identity and `plugin` otherwise). A run's source is kept
 * with the run here, and sent once the pinned schema takes it.
 */

import type { Result } from "@mainahq/core";
import type { EventInput } from "../outbox";
import eventSchema from "../protocol/v1/event.schema.json" with {
	type: "json",
};
import type { UplinkError } from "../uplink";
import {
	count,
	type Emitted,
	type EventSink,
	emit,
	isHash,
	isLabel,
	label,
	optional,
} from "./emit";

export const RUN_SOURCES = ["plugin", "maina-run", "ci"] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

const VERDICTS = ["allow", "ask", "deny"] as const;
type RunVerdict = (typeof VERDICTS)[number];

const OUTCOMES = ["succeeded", "failed", "cancelled", "stopped"] as const;
type RunOutcome = (typeof OUTCOMES)[number];

/** One fact of a run's lifecycle, as the harness and the hooks report it. */
export type RunFact =
	| Readonly<{
			type: "run.started";
			runId: string;
			source: RunSource;
			/** The agent doing the work, a label (`claude`, `claude-code`). */
			agent: string;
			/** What hosts it: the plugin's host, or `maina-run`. */
			host?: string;
			repoHash?: string;
			branchHash?: string;
	  }>
	| Readonly<{
			type: "run.step";
			runId: string;
			/** 1 for the run's first gated call. */
			step: number;
			/** The gate event's kind (`shell`, `file.write`, `mcp`, ...). */
			toolClass: string;
			verdict: RunVerdict;
	  }>
	| Readonly<{
			type: "run.finished";
			runId: string;
			outcome: RunOutcome;
			durationMs: number;
			steps: number;
	  }>;

/** The schema's id pattern (`ID`). */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
/** Stricter than the schema: no `/`, so a run id is never a path. */
const isRunId = (value: unknown): value is string =>
	typeof value === "string" && RUN_ID.test(value) && !value.includes("/");

const oneOf =
	<T extends string>(values: readonly T[]) =>
	(value: unknown): value is T =>
		typeof value === "string" && (values as readonly string[]).includes(value);

export const isRunVerdict = oneOf(VERDICTS);
const isOutcome = oneOf(OUTCOMES);
const isSource = oneOf(RUN_SOURCES);

/** Whether the pinned schema takes `source` on `run.started` (not v1 yet). */
const SOURCE_ON_WIRE =
	"source" in eventSchema.$defs["run.started.metadata"].properties;

const isCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

/** `fact` as a metadata event, or null when it has no such form. */
export function runEvent(fact: RunFact): EventInput | null {
	if (!isRunId(fact.runId)) return null;
	switch (fact.type) {
		case "run.started":
			return {
				type: "run.started",
				runId: fact.runId,
				data: {
					agent: label(fact.agent),
					...optional("host", fact.host, isLabel),
					...optional("repoHash", fact.repoHash, isHash),
					...optional("branchHash", fact.branchHash, isHash),
					...(SOURCE_ON_WIRE ? optional("source", fact.source, isSource) : {}),
				},
			};
		case "run.step":
			if (!isRunVerdict(fact.verdict)) return null;
			return {
				type: "run.step",
				runId: fact.runId,
				data: {
					step: count(fact.step),
					toolClass: label(fact.toolClass),
					verdict: fact.verdict,
				},
			};
		case "run.finished":
			if (!isOutcome(fact.outcome)) return null;
			return {
				type: "run.finished",
				runId: fact.runId,
				data: {
					outcome: fact.outcome,
					durationMs: count(fact.durationMs),
					steps: count(fact.steps),
				},
			};
		default: {
			const unknown: never = fact;
			return unknown;
		}
	}
}

export function emitRun(
	sink: EventSink,
	fact: RunFact,
): Result<Emitted, UplinkError> {
	return emit(sink, runEvent(fact));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
	typeof value === "string" && value !== "";

/** An optional text field of `value`, as `{ key }` or nothing; null when not text. */
function optionalText(
	value: Record<string, unknown>,
	key: string,
): Record<string, string> | null {
	const v = value[key];
	if (v === undefined) return {};
	return isText(v) ? { [key]: v } : null;
}

/**
 * A run fact from untrusted input (the runtime's `run.event` IPC), or null
 * when it is not one. Labels and hashes are checked again by `runEvent`.
 */
export function parseRunFact(value: unknown): RunFact | null {
	if (!isRecord(value) || !isText(value.runId)) return null;
	const { runId } = value;
	switch (value.type) {
		case "run.started": {
			if (!isSource(value.source) || !isText(value.agent)) return null;
			const host = optionalText(value, "host");
			const repoHash = optionalText(value, "repoHash");
			const branchHash = optionalText(value, "branchHash");
			if (host === null || repoHash === null || branchHash === null) {
				return null;
			}
			return {
				type: "run.started",
				runId,
				source: value.source,
				agent: value.agent,
				...host,
				...repoHash,
				...branchHash,
			};
		}
		case "run.step":
			if (
				!isCount(value.step) ||
				!isText(value.toolClass) ||
				!isRunVerdict(value.verdict)
			) {
				return null;
			}
			return {
				type: "run.step",
				runId,
				step: value.step,
				toolClass: value.toolClass,
				verdict: value.verdict,
			};
		case "run.finished":
			if (
				!isOutcome(value.outcome) ||
				!isCount(value.durationMs) ||
				!isCount(value.steps)
			) {
				return null;
			}
			return {
				type: "run.finished",
				runId,
				outcome: value.outcome,
				durationMs: value.durationMs,
				steps: value.steps,
			};
		default:
			return null;
	}
}
