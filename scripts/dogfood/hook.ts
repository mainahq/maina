#!/usr/bin/env bun
/**
 * Maina dogfood hook: the Maina repo's own Claude Code `PreToolUse` hook
 * (#286, FR-DOG-1/2; #309 replaced the rules-only bootstrap with this).
 *
 * Wired from the repo's `.claude/settings.json`. It runs the real hook path
 * from source, the one the standalone runtime's `maina hook --host claude
 * PreToolUse` runs: the Claude Code adapter normalises the tool call, the fail-closed
 * hook client asks the resident runtime (spawning one when none answers)
 * and the gate (`evaluateGate`) decides. When the runtime cannot answer,
 * the rules-only gate runs in process and never allows.
 *
 * Every verdict is passed on, `allow` included, exactly as `maina hook
 * PreToolUse` would print it: the gate knows this repo's protected branches
 * (`.maina/policy.json`) and the branch checked out, so its allows no
 * longer need Claude Code's own prompt behind them (mainahq/maina#459). A
 * deny also exits 2 with the gate message on stderr. The settings.json command
 * falls back to `ask` if this script cannot start at all.
 *
 * Override: launch Claude Code with MAINA_DOGFOOD_OVERRIDE=1 and denies
 * become `ask` (you still confirm each one); the log records
 * `override: true`.
 *
 * Every gated decision is appended to `.maina/dogfood/log.jsonl`
 * (gitignored; `MAINA_DOGFOOD_LOG` overrides the path) as
 * `{ ts, tool, action, verdict, reason, override?, root, host,
 * permissionMode, decisionIds, toolUseId?, sessionId? }`: a local trail with
 * the command text, for friction reports. `root`, `host`, `permissionMode`
 * and `decisionIds` (#584) let an exporter rebuild the gate event under its
 * workspace root and join the record to the decision log's outcomes. The
 * weekly report reads the decision log instead (`.maina/decisions.db`,
 * #570), which the runtime this hook asks appends its gate decisions to, as
 * hashes and labels only.
 *
 * Outcomes (FR-S1-4, FR-DOG-3): `hook.ts post`, wired for the same tools as
 * the `PostToolUse`, `PostToolUseFailure` and `PermissionDenied` hooks,
 * appends one outcome record per gated call. It never blocks, prints or
 * fails the tool, and never records the tool's response, its error or the
 * classifier's reason.
 *
 * - PostToolUse runs only after a tool succeeds, and PostToolUseFailure only
 *   after an allowed tool fails; Claude Code fires neither when the user
 *   refuses the call. Both append `{ ts, kind: "ran", failed?, tool, action,
 *   toolUseId?, sessionId?, root, host }`, with `failed: true` for a
 *   failure. Either way the call ran, so the user approved it (#659).
 * - PermissionDenied runs when the auto-mode classifier denies the call. It
 *   appends `{ ts, kind: "denied", tool, toolUseId?, sessionId?, root, host }`:
 *   the call did not run, but the user did not refuse it either.
 *
 * So an ask whose `toolUseId` has a `ran` record in the same session was
 * approved, one with a `denied` record was denied by the classifier, and one
 * with neither was refused or abandoned. Set `MAINA_DOGFOOD_LOG` globally
 * (say to `~/.maina/dogfood/log.jsonl`) so every checkout and worktree
 * appends to one file.
 */

import {
	PERMISSION_MODES,
	type PermissionMode,
} from "../../packages/core/src/gate/events";
import {
	CLAUDE_HOST,
	type ClaudeEvent,
	type ClaudeOutput,
	fromClaude,
} from "../../packages/runtime/src/adapters/claude-code";
import {
	type ClaudeHookPorts,
	type ClaudeHookRun,
	parseHookInput,
	runClaudeHook,
} from "../../packages/runtime/src/claude-hook";

export type Verdict = "allow" | "ask" | "deny";

/** One line of the dogfood log, read back by `report.ts`. */
export interface LogRecord {
	readonly ts: string;
	readonly tool: string;
	readonly action: string;
	readonly verdict: Verdict;
	readonly reason: string;
	readonly override?: true;
	/**
	 * Workspace root the call was gated under: the git root of the host's
	 * directory. Empty when there is none (outside a repository, a failed
	 * lookup, a malformed call), as the gate then had no root either.
	 */
	readonly root: string;
	/** Host that made the call. */
	readonly host: string;
	/** The host's permission mode, normalised by the adapter. */
	readonly permissionMode: PermissionMode;
	/** Ids of the `action.risk` decisions behind the verdict. */
	readonly decisionIds: readonly string[];
	/** Claude Code's `tool_use_id`, when the payload had one. */
	readonly toolUseId?: string;
	/** Claude Code's `session_id`, when the payload had one. */
	readonly sessionId?: string;
}

/**
 * The post hook's line: a gated call ran. Paired with the pre record by
 * `toolUseId` (within `sessionId`), it says an ask was approved. Never holds
 * the tool's response or error.
 */
export interface RanRecord {
	readonly ts: string;
	readonly kind: "ran";
	/** The tool ran and failed (PostToolUseFailure); it was still approved. */
	readonly failed?: true;
	readonly tool: string;
	/** As on the pre record: the command, path, URL or MCP tool. */
	readonly action: string;
	readonly toolUseId?: string;
	readonly sessionId?: string;
	/** Workspace root, as on the pre record; empty when unknown. */
	readonly root: string;
	readonly host: string;
}

/**
 * The post hook's line for a call the auto-mode classifier denied
 * (PermissionDenied): it never ran, and the user did not refuse it. Holds
 * neither the action nor the classifier's reason, which may quote it.
 */
export interface DeniedRecord {
	readonly ts: string;
	readonly kind: "denied";
	readonly tool: string;
	readonly toolUseId?: string;
	readonly sessionId?: string;
	/** Workspace root, as on the pre record; empty when unknown. */
	readonly root: string;
	readonly host: string;
}

/** What became of a gated call, as the post hook logs it. */
export type OutcomeRecord = RanRecord | DeniedRecord;

export interface DogfoodPostDeps {
	readonly now: () => string;
	/** As `DogfoodDeps.rootOf`. */
	readonly rootOf: (cwd: string) => string | null;
	/** Appends one record; best-effort. */
	readonly log: (record: OutcomeRecord) => void;
}

export interface DogfoodDeps {
	readonly ports: ClaudeHookPorts;
	/** MAINA_DOGFOOD_OVERRIDE=1: denies become asks. */
	readonly override: boolean;
	readonly now: () => string;
	/**
	 * The workspace root for a directory, or null outside a repository; the
	 * lookup the runtime's gate makes. Best-effort: a throw counts as null,
	 * and null is logged as an empty root.
	 */
	readonly rootOf: (cwd: string) => string | null;
	/** Appends one record; best-effort, never changes the decision. */
	readonly log: (record: LogRecord) => void;
}

const HOOK_EVENT = "PreToolUse";
const MAX_ACTION = 200;

const SILENT: ClaudeOutput = { exitCode: 0, stdout: "", stderr: "" };

/** What the tool call does, for the log: its command, path, tool or URL. */
function actionOf(event: ClaudeEvent): string {
	if (event.type !== "gate") return "";
	const { input } = event.event;
	const pick = [input.command, input.path, input.url].find(
		(v): v is string => typeof v === "string",
	);
	const raw =
		pick ??
		(typeof input.server === "string" && typeof input.tool === "string"
			? `${input.server}/${input.tool}`
			: "");
	return raw.length > MAX_ACTION ? `${raw.slice(0, MAX_ACTION - 3)}...` : raw;
}

const MODES: ReadonlySet<string> = new Set(PERMISSION_MODES);

/**
 * The git root of `cwd`; empty when there is none or the lookup fails. The
 * gate has no root then either (it asks without evaluating), so `cwd` would
 * be a guess.
 */
function rootFor(cwd: string, rootOf: DogfoodDeps["rootOf"]): string {
	try {
		return rootOf(cwd) ?? "";
	} catch {
		return "";
	}
}

/**
 * Where and how the call was gated, for the log (#584). A malformed call
 * was never read, so it claims no root and an unknown mode.
 */
function contextOf(
	run: ClaudeHookRun,
	rootOf: DogfoodDeps["rootOf"],
): Pick<LogRecord, "root" | "host" | "permissionMode"> {
	if (run.event.type !== "gate") {
		return { root: "", host: CLAUDE_HOST, permissionMode: "unknown" };
	}
	const { input, cwd } = run.event.event;
	const mode = input.permissionMode;
	return {
		root: cwd === undefined ? "" : rootFor(cwd, rootOf),
		host: typeof input.host === "string" ? input.host : CLAUDE_HOST,
		permissionMode:
			typeof mode === "string" && MODES.has(mode)
				? (mode as PermissionMode)
				: "unknown",
	};
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The payload's `tool_use_id` and `session_id`, best-effort: each is left
 * out unless it is a non-empty string.
 */
function idsOf(payload: unknown): Pick<LogRecord, "toolUseId" | "sessionId"> {
	if (!isRecord(payload)) return {};
	const { tool_use_id: toolUseId, session_id: sessionId } = payload;
	return {
		...(typeof toolUseId === "string" && toolUseId !== "" ? { toolUseId } : {}),
		...(typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}),
	};
}

/**
 * Runs the hook over raw stdin and returns what to print. Logs every gated
 * or malformed tool call; leaves tools maina does not gate alone.
 */
export async function runDogfoodHook(
	raw: string,
	deps: DogfoodDeps,
): Promise<ClaudeOutput> {
	const run = await runClaudeHook(raw, deps.ports, HOOK_EVENT);
	const decision = run.decision;
	if (decision === undefined) return SILENT;

	const overridden = decision.verdict === "deny" && deps.override;
	const final = overridden
		? { verdict: "ask" as const, reason: `[override] ${decision.reason}` }
		: decision;
	const malformed = run.event.type === "malformed";
	try {
		deps.log({
			ts: deps.now(),
			tool: run.event.type === "gate" ? run.event.tool : "unknown",
			action: actionOf(run.event),
			verdict: final.verdict,
			reason: malformed ? `hook crash: ${final.reason}` : final.reason,
			...(overridden ? { override: true as const } : {}),
			...contextOf(run, deps.rootOf),
			decisionIds: decision.decisionIds,
			...(malformed ? {} : idsOf(parseHookInput(raw))),
		});
	} catch {
		// Logging is best-effort; it never changes the decision.
	}

	if (!overridden) return run.output;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify({
			hookSpecificOutput: {
				hookEventName: HOOK_EVENT,
				permissionDecision: "ask",
				permissionDecisionReason: final.reason,
			},
		})}\n`,
		stderr: "",
	};
}

type PostOutcome = "ran" | "failed" | "denied";

/** The hook events the post mode logs, and the outcome each one records. */
const POST_EVENTS: ReadonlyMap<unknown, PostOutcome> = new Map([
	["PostToolUse", "ran"],
	["PostToolUseFailure", "failed"],
	["PermissionDenied", "denied"],
]);

/**
 * The post mode: logs what became of a gated call. `PostToolUse` (the tool
 * succeeded) and `PostToolUseFailure` (it failed) log a `ran` record, the
 * latter marked `failed`; `PermissionDenied` (the auto-mode classifier
 * denied it) logs a `denied` record. The payload is read as its PreToolUse
 * twin would be, so the tool and action match the pre record's; the tool's
 * response, its error and the classifier's reason are never looked at.
 * Always silent and exit 0: it never blocks or fails the tool. Tools maina
 * does not gate and payloads it cannot read are not logged.
 */
export function runDogfoodPostHook(
	raw: string,
	deps: DogfoodPostDeps,
): ClaudeOutput {
	try {
		const payload = parseHookInput(raw);
		if (!isRecord(payload)) return SILENT;
		const outcome = POST_EVENTS.get(payload.hook_event_name);
		if (outcome === undefined) return SILENT;
		const {
			tool_response: _response,
			error: _error,
			reason: _reason,
			...call
		} = payload;
		const event = fromClaude({ ...call, hook_event_name: HOOK_EVENT });
		if (event.type !== "gate") return SILENT;
		const { cwd, input } = event.event;
		const ts = deps.now();
		const where = {
			...idsOf(payload),
			root: cwd === undefined ? "" : rootFor(cwd, deps.rootOf),
			host: typeof input.host === "string" ? input.host : CLAUDE_HOST,
		};
		deps.log(
			outcome === "denied"
				? { ts, kind: "denied", tool: event.tool, ...where }
				: {
						ts,
						kind: "ran",
						...(outcome === "failed" ? { failed: true as const } : {}),
						tool: event.tool,
						action: actionOf(event),
						...where,
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
	const { systemClaudeHookPorts } = await import(
		"../../packages/runtime/src/hook-system"
	);
	const { gitProbe, resolveRoot } = await import(
		"../../packages/runtime/src/root"
	);
	const repoRoot = resolve(import.meta.dir, "../..");
	const logPath =
		process.env.MAINA_DOGFOOD_LOG ??
		resolve(repoRoot, ".maina/dogfood/log.jsonl");
	const rootOf = (cwd: string): string | null => {
		const root = resolveRoot({ cwd }, gitProbe);
		return root.ok ? root.value.path : null;
	};
	const append = (record: LogRecord | OutcomeRecord): void => {
		mkdirSync(dirname(logPath), { recursive: true });
		appendFileSync(logPath, `${JSON.stringify(record)}\n`);
	};
	const stdin = await Bun.stdin.text();
	const out =
		process.argv[2] === "post"
			? runDogfoodPostHook(stdin, {
					now: () => new Date().toISOString(),
					rootOf,
					log: append,
				})
			: await runDogfoodHook(stdin, {
					ports: systemClaudeHookPorts(),
					override: process.env.MAINA_DOGFOOD_OVERRIDE === "1",
					now: () => new Date().toISOString(),
					rootOf,
					log: append,
				});
	process.stdout.write(out.stdout);
	process.stderr.write(out.stderr);
	process.exitCode = out.exitCode;
}
