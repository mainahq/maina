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
 * permissionMode, decisionIds }`: a local trail with the command text, for
 * friction reports. `root`, `host`, `permissionMode` and `decisionIds`
 * (#584) let an exporter rebuild the gate event under its workspace root and
 * join the record to the decision log's outcomes. The weekly report reads
 * the decision log instead (`.maina/decisions.db`, #570), which the runtime
 * this hook asks appends its gate decisions to, as hashes and labels only.
 */

import {
	PERMISSION_MODES,
	type PermissionMode,
} from "../../packages/core/src/gate/events";
import {
	CLAUDE_HOST,
	type ClaudeOutput,
} from "../../packages/runtime/src/adapters/claude-code";
import {
	type ClaudeHookPorts,
	type ClaudeHookRun,
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
function actionOf(run: ClaudeHookRun): string {
	if (run.event.type !== "gate") return "";
	const { input } = run.event.event;
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
			action: actionOf(run),
			verdict: final.verdict,
			reason: malformed ? `hook crash: ${final.reason}` : final.reason,
			...(overridden ? { override: true as const } : {}),
			...contextOf(run, deps.rootOf),
			decisionIds: decision.decisionIds,
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
	const out = await runDogfoodHook(await Bun.stdin.text(), {
		ports: systemClaudeHookPorts(),
		override: process.env.MAINA_DOGFOOD_OVERRIDE === "1",
		now: () => new Date().toISOString(),
		rootOf: (cwd) => {
			const root = resolveRoot({ cwd }, gitProbe);
			return root.ok ? root.value.path : null;
		},
		log: (record) => {
			mkdirSync(dirname(logPath), { recursive: true });
			appendFileSync(logPath, `${JSON.stringify(record)}\n`);
		},
	});
	process.stdout.write(out.stdout);
	process.stderr.write(out.stderr);
	process.exitCode = out.exitCode;
}
