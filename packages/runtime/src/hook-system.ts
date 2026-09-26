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
 * `runClaudeHookProcess`, `runCursorHookProcess` and `runCodexHookProcess`
 * are the whole hook process: stdin in, the host's answer out. The
 * standalone runtime's `hook` mode runs the one for the hook's host.
 */

import { existsSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import cliPackage from "@mainahq/cli/package.json" with { type: "json" };
import { openDecisionDb } from "@mainahq/cli/src/decision-store";
import { formatSessionSummary, readLogSlice, summarise } from "@mainahq/core";
import type { SessionEvent } from "./adapters/claude-code";
import {
	type ClaudeHookPorts,
	type ClaudeHookRun,
	runClaudeHook,
	stopFromClient,
} from "./claude-hook";
import { createHookClient } from "./client/hook-client";
import { runCodexHook } from "./codex-hook";
import { runCursorHook } from "./cursor-hook";
import { systemGates } from "./gate-system";
import { daemonSpawner } from "./lifecycle";
import { defaultRuntimeDir, resolveEndpoint } from "./registry";
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

/** This session's summary line from the repository's decision log. */
function sessionSummary(event: SessionEvent): string | undefined {
	if (event.cwd === undefined) return undefined;
	const root = resolveRoot({ cwd: event.cwd }, gitProbe);
	if (!root.ok) return undefined;
	const mainaDir = join(root.value.path, ".maina");
	// Never create a decision log just to find it empty.
	if (!existsSync(join(mainaDir, "decisions.db"))) return undefined;
	const store = openDecisionDb(mainaDir);
	if (!store.ok) return undefined;
	try {
		const slice = readLogSlice(
			{ db: store.value.db },
			{ sessionId: event.sessionId },
		);
		return slice.ok ? formatSessionSummary(summarise(slice.value)) : undefined;
	} finally {
		store.value.close();
	}
}

export function systemClaudeHookPorts(
	options: HookSystemOptions = {},
): ClaudeHookPorts {
	const env = options.env ?? process.env;
	const version = cliPackage.version;
	const endpoint = resolveEndpoint({
		platform: process.platform,
		dir: defaultRuntimeDir(env, homedir()),
		user: userInfo().username,
		version,
		tmpDir: tmpdir(),
	});
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
 * One hook process for Claude Code event `hookEvent`: reads stdin, writes
 * the host's answer and resolves to the exit code.
 */
export async function runClaudeHookProcess(hookEvent: string): Promise<number> {
	const run: ClaudeHookRun = await runClaudeHook(
		await Bun.stdin.text(),
		systemClaudeHookPorts(),
		hookEvent,
	);
	process.stdout.write(run.output.stdout);
	if (run.output.stderr !== "") process.stderr.write(run.output.stderr);
	return run.output.exitCode;
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
	process.stdout.write(run.output.stdout);
	if (run.output.stderr !== "") process.stderr.write(run.output.stderr);
	return run.output.exitCode;
}
