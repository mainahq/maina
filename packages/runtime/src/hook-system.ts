/**
 * The real Claude Code, Cursor and Codex hooks (FR-GATE-7): `runClaudeHook`,
 * `runCursorHook` and `runCodexHook` over the machine.
 *
 * - The gate is the fail-closed hook client (ADR 0044): it asks the resident
 *   runtime, spawning one when none answers, and falls back to the
 *   rules-only gate in process, never allowing, when the runtime cannot
 *   answer in time.
 * - The Stop hook asks the runtime to verify the session's changes, with a
 *   budget long enough for a verify run; when verify cannot answer in time
 *   the stop is let through with a notice saying so (#480).
 * - The session summary reads this session's gate and routing decisions
 *   from the repository's decision log (`.maina/decisions.db`), when there
 *   is one; a repository without one gets no summary.
 *
 * - An ask, and a finished verify, notify the human in a terminal that
 *   shows notifications (FR-RET-6, ADR 0049): through the hook's
 *   `terminalSequence` for Claude Code, which gives hooks no terminal, and
 *   written to the controlling terminal for Codex and Cursor.
 *
 * `runClaudeHookProcess`, `runCursorHookProcess` and `runCodexHookProcess`
 * are the whole hook process: stdin in, the host's answer out. The
 * standalone runtime's `hook` mode runs the one for the hook's host.
 */

import { closeSync, constants, existsSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import cliPackage from "@mainahq/cli/package.json" with { type: "json" };
import { openDecisionDb } from "@mainahq/cli/src/decision-store";
import {
	formatSessionSummary,
	readLogSlice,
	type SessionSummary,
	summarise,
} from "@mainahq/core";
import type { SessionEvent } from "./adapters/claude-code";
import {
	type ClaudeHookPorts,
	type ClaudeHookRun,
	runClaudeHook,
	stopFromClient,
	withNotification,
} from "./claude-hook";
import { createHookClient } from "./client/hook-client";
import { runCodexHook } from "./codex-hook";
import { runCursorHook } from "./cursor-hook";
import { systemGates } from "./gate-system";
import { daemonSpawner } from "./lifecycle";
import { type HookOutcome, notify, notifyEventOf } from "./notify/notify";
import { userEndpoint } from "./registry";
import { gitProbe, resolveRoot } from "./root";

/** How long one hook waits for the gate, runtime spawn included. */
const HOOK_TIMEOUT_MS = 3_000;

/**
 * How long the Stop hook waits for verify on the session's changes, runtime
 * spawn included. A verify run takes far longer than a gate decision; with
 * the gate's budget a failed verify would be dropped (#480). The host's own
 * timeout for the Stop hook must be longer than this.
 */
const STOP_TIMEOUT_MS = 120_000;

/** A runtime with no request for this long exits. */
const RUNTIME_IDLE_TTL_MS = 30 * 60_000;

type HookSystemOptions = Readonly<{
	env?: Readonly<Record<string, string | undefined>>;
	/** The gate's budget per event; `HOOK_TIMEOUT_MS` by default. */
	timeoutMs?: number;
	/** Verify on stop's budget; `STOP_TIMEOUT_MS` by default. */
	stopTimeoutMs?: number;
}>;

/**
 * A session's gate and routing summary from the decision log of the
 * repository around `cwd`; null when there is none (or nothing happened).
 */
export function readSessionSummary(
	cwd: string,
	sessionId: string | undefined,
): SessionSummary | null {
	const root = resolveRoot({ cwd }, gitProbe);
	if (!root.ok) return null;
	const mainaDir = join(root.value.path, ".maina");
	// Never create a decision log just to find it empty.
	if (!existsSync(join(mainaDir, "decisions.db"))) return null;
	const store = openDecisionDb(mainaDir);
	if (!store.ok) return null;
	try {
		const slice = readLogSlice({ db: store.value.db }, { sessionId });
		return slice.ok ? summarise(slice.value) : null;
	} finally {
		store.value.close();
	}
}

/** This session's summary line from the repository's decision log. */
function sessionSummary(event: SessionEvent): string | undefined {
	if (event.cwd === undefined) return undefined;
	return formatSessionSummary(readSessionSummary(event.cwd, event.sessionId));
}

export function systemClaudeHookPorts(
	options: HookSystemOptions = {},
): ClaudeHookPorts {
	const env = options.env ?? process.env;
	const version = cliPackage.version;
	const endpoint = userEndpoint(env, version);
	const client = createHookClient({
		endpoint,
		version,
		spawn: daemonSpawner({ endpoint, version, idleTtlMs: RUNTIME_IDLE_TTL_MS }),
		fallback: systemGates().fallback,
	});
	const timeoutMs = options.timeoutMs ?? HOOK_TIMEOUT_MS;
	const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
	return {
		evaluate: (event) => client.evaluate(event, { timeoutMs }),
		sessionSummary: async (event) => sessionSummary(event),
		stopVerify: async (event) =>
			stopFromClient(
				await client.evaluate(event, { timeoutMs: stopTimeoutMs }),
				stopTimeoutMs,
			),
	};
}

/**
 * Writes `sequence` to the controlling terminal, the way a host that gives
 * its hooks one (Codex, Cursor's CLI) lets them reach it. Throws when there
 * is none; `notify` swallows that. Opened write-only without O_CREAT or
 * O_TRUNC, so a missing device (Windows resolves "/dev/tty" to a path on
 * the current drive) is an error, never a new file.
 */
export function writeTty(sequence: string, path = "/dev/tty"): void {
	const fd = openSync(path, constants.O_WRONLY);
	try {
		writeSync(fd, sequence);
	} finally {
		closeSync(fd);
	}
}

/** The run's notification on the controlling terminal, if it needs one. */
function notifyOnTty(run: HookOutcome): void {
	const event = notifyEventOf(run);
	if (event !== undefined) notify(event, { env: process.env, emit: writeTty });
}

/**
 * One hook process for Claude Code event `hookEvent`: reads stdin, writes
 * the host's answer and resolves to the exit code.
 */
export async function runClaudeHookProcess(hookEvent: string): Promise<number> {
	const run: ClaudeHookRun = await runClaudeHook(
		await Bun.stdin.text(),
		systemClaudeHookPorts(),
		hookEvent,
	);
	const output = withNotification(run, process.env);
	process.stdout.write(output.stdout);
	if (output.stderr !== "") process.stderr.write(output.stderr);
	return output.exitCode;
}

/**
 * One hook process for Cursor event `hookEvent` (mainahq/maina#310): the
 * same gate and summary as Claude Code, in Cursor's wire format.
 */
export async function runCursorHookProcess(hookEvent: string): Promise<number> {
	const run = await runCursorHook(
		await Bun.stdin.text(),
		systemClaudeHookPorts(),
		hookEvent,
	);
	notifyOnTty(run);
	process.stdout.write(run.output.stdout);
	if (run.output.stderr !== "") process.stderr.write(run.output.stderr);
	return run.output.exitCode;
}

/**
 * One hook process for Codex event `hookEvent` (mainahq/maina#475): the
 * same gate and summary as Claude Code, in Codex's wire format, where an
 * `ask` on PreToolUse is a deny.
 */
export async function runCodexHookProcess(hookEvent: string): Promise<number> {
	const run = await runCodexHook(
		await Bun.stdin.text(),
		systemClaudeHookPorts(),
		hookEvent,
	);
	notifyOnTty(run);
	process.stdout.write(run.output.stdout);
	if (run.output.stderr !== "") process.stderr.write(run.output.stderr);
	return run.output.exitCode;
}
