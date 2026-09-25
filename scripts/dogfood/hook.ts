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
 * Tighten only: an `allow` prints nothing, so Claude Code's own permission
 * flow stands, as it did under the bootstrap. The gate does not yet know
 * this repo's protected branches (`v1/main`) or the current branch, so
 * letting its allows skip Claude Code's prompts would loosen the guard
 * (mainahq/maina#459).
 * `ask` and `deny` are passed on; a deny also exits 2 with the reason on
 * stderr. The settings.json command falls back to `ask` if this script
 * cannot start at all.
 *
 * Override: launch Claude Code with MAINA_DOGFOOD_OVERRIDE=1 and denies
 * become `ask` (you still confirm each one); the log records
 * `override: true`.
 *
 * Every gated decision is appended to `.maina/dogfood/log.jsonl`
 * (gitignored; `MAINA_DOGFOOD_LOG` overrides the path) as
 * `{ ts, tool, action, verdict, reason, override? }` and summarised weekly
 * by `bun run dogfood:report`.
 */

import type { ClaudeOutput } from "../../packages/runtime/src/adapters/claude-code";
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
}

export interface DogfoodDeps {
	readonly ports: ClaudeHookPorts;
	/** MAINA_DOGFOOD_OVERRIDE=1: denies become asks. */
	readonly override: boolean;
	readonly now: () => string;
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
		});
	} catch {
		// Logging is best-effort; it never changes the decision.
	}

	if (final.verdict === "allow") return SILENT;
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
	const repoRoot = resolve(import.meta.dir, "../..");
	const logPath =
		process.env.MAINA_DOGFOOD_LOG ??
		resolve(repoRoot, ".maina/dogfood/log.jsonl");
	const out = await runDogfoodHook(await Bun.stdin.text(), {
		ports: systemClaudeHookPorts(),
		override: process.env.MAINA_DOGFOOD_OVERRIDE === "1",
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
