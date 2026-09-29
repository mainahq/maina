#!/usr/bin/env bun
/**
 * Maina dogfood outcome hook (FR-S1-4, FR-DOG-3): what became of a gated
 * call, for the `PreToolUse` records `hook.ts` writes. Wired from the repo's
 * `.claude/settings.json` for the same tools as the `PostToolUse`,
 * `PostToolUseFailure` and `PermissionDenied` hooks, it appends one outcome
 * record per gated call to the dogfood log (`MAINA_DOGFOOD_LOG`, or
 * `.maina/dogfood/log.jsonl`). It never blocks, prints or fails the tool.
 *
 * - PostToolUse runs only after a tool succeeds, and PostToolUseFailure only
 *   after an allowed tool fails; Claude Code fires neither when the user
 *   refuses the call. Both append `{ ts, kind: "ran", failed?, tool,
 *   toolUseId?, sessionId?, host }`, with `failed: true` for a failure.
 *   Either way the call ran, so the user approved it (#659).
 * - PermissionDenied runs when the auto-mode classifier denies the call. It
 *   appends `{ ts, kind: "denied", tool, toolUseId?, sessionId?, host }`: the
 *   call did not run, but the user did not refuse it either.
 *
 * So an ask whose `toolUseId` has a `ran` record in the same session was
 * approved, one with a `denied` record was denied by the classifier, and one
 * with neither was refused or abandoned.
 *
 * Pairing needs only `toolUseId` and `sessionId`, so a record holds nothing
 * else from the payload (#660): not the command, path, URL or MCP tool (the
 * pre record has those, and they can carry secrets), not the tool's
 * response, its error or the classifier's reason, and not the root, whose
 * lookup would spawn git. It runs after every gated call, each Read, Grep
 * and Glob included, so it loads nothing but its own helpers: no runtime
 * hook system, no adapter (which loads all of core), no git.
 */

import type { ClaudeOutput } from "../../packages/runtime/src/adapters/claude-code";

/**
 * A gated call ran. Paired with the pre record by `toolUseId` (within
 * `sessionId`), it says an ask was approved.
 */
export interface RanRecord {
	readonly ts: string;
	readonly kind: "ran";
	/** The tool ran and failed (PostToolUseFailure); it was still approved. */
	readonly failed?: true;
	/** Claude Code's tool name, as on the pre record. */
	readonly tool: string;
	readonly toolUseId?: string;
	readonly sessionId?: string;
	readonly host: string;
}

/**
 * The auto-mode classifier denied a gated call (PermissionDenied): it never
 * ran, and the user did not refuse it.
 */
export interface DeniedRecord {
	readonly ts: string;
	readonly kind: "denied";
	readonly tool: string;
	readonly toolUseId?: string;
	readonly sessionId?: string;
	readonly host: string;
}

/** What became of a gated call. */
export type OutcomeRecord = RanRecord | DeniedRecord;

export interface DogfoodPostDeps {
	readonly now: () => string;
	/** Appends one record; best-effort. */
	readonly log: (record: OutcomeRecord) => void;
}

/**
 * The tools maina gates, as the Claude Code adapter's `tool.before` matcher
 * has them (a test keeps the two equal); the adapter itself is not imported,
 * as it loads all of core.
 */
export const GATED_TOOLS =
	"^(Bash|Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob|WebFetch|mcp__.*)$";

/** The host the Claude Code adapter stamps on every gate event. */
export const CLAUDE_HOST = "claude-code";

const GATED = new RegExp(GATED_TOOLS);

const SILENT: ClaudeOutput = { exitCode: 0, stdout: "", stderr: "" };

type Outcome = "ran" | "failed" | "denied";

/** The hook events this hook logs, and the outcome each one records. */
const EVENTS: ReadonlyMap<unknown, Outcome> = new Map([
	["PostToolUse", "ran"],
	["PostToolUseFailure", "failed"],
	["PermissionDenied", "denied"],
]);

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

function parse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * The payload's `tool_use_id` and `session_id`, best-effort: each is left
 * out unless it is a non-empty string.
 */
export function idsOf(payload: unknown): {
	readonly toolUseId?: string;
	readonly sessionId?: string;
} {
	if (!isRecord(payload)) return {};
	const { tool_use_id: toolUseId, session_id: sessionId } = payload;
	return {
		...(typeof toolUseId === "string" && toolUseId !== "" ? { toolUseId } : {}),
		...(typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}),
	};
}

/**
 * Logs what became of a gated call: `PostToolUse` (the tool succeeded) and
 * `PostToolUseFailure` (it failed) log a `ran` record, the latter marked
 * `failed`; `PermissionDenied` (the auto-mode classifier denied it) logs a
 * `denied` record. Reads only the event, the tool name and the two ids,
 * and checks the call has a `tool_input`. Always silent and exit 0: it
 * never blocks or fails the tool. Tools maina does not gate and payloads it
 * cannot read are not logged.
 */
export function runDogfoodPostHook(
	raw: string,
	deps: DogfoodPostDeps,
): ClaudeOutput {
	try {
		const payload = parse(raw);
		if (!isRecord(payload)) return SILENT;
		const outcome = EVENTS.get(payload.hook_event_name);
		const tool = payload.tool_name;
		if (outcome === undefined || typeof tool !== "string") return SILENT;
		if (!GATED.test(tool) || !isRecord(payload.tool_input)) return SILENT;
		const ts = deps.now();
		const rest = { tool, ...idsOf(payload), host: CLAUDE_HOST };
		deps.log(
			outcome === "denied"
				? { ts, kind: "denied", ...rest }
				: {
						ts,
						kind: "ran",
						...(outcome === "failed" ? { failed: true as const } : {}),
						...rest,
					},
		);
	} catch {
		// Best-effort: the tool already ran; nothing here may fail it.
	}
	return SILENT;
}

// ── Imperative shell ─────────────────────────────────────────────────────

if (import.meta.main) {
	const { appendFileSync, mkdirSync } = await import("node:fs");
	const { dirname, resolve } = await import("node:path");
	const logPath =
		process.env.MAINA_DOGFOOD_LOG ??
		resolve(import.meta.dir, "../../.maina/dogfood/log.jsonl");
	const out = runDogfoodPostHook(await Bun.stdin.text(), {
		now: () => new Date().toISOString(),
		log: (record) => {
			mkdirSync(dirname(logPath), { recursive: true });
			appendFileSync(logPath, `${JSON.stringify(record)}\n`);
		},
	});
	process.stdout.write(out.stdout);
	process.stderr.write(out.stderr);
	process.exitCode = out.exitCode;
}
