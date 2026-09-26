/**
 * Runs one host hook command the way a host does: through `/bin/sh -c`, in
 * the project dir, with the host's env and the event's JSON on stdin.
 */

import type { Env } from "./types";

export interface HookRun {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/** Claude Code's default hook timeout. */
const HOOK_TIMEOUT_MS = 60_000;

export async function runHookCommand(
	command: string,
	input: unknown,
	env: Env,
	cwd: string,
): Promise<HookRun> {
	const proc = Bun.spawn(["/bin/sh", "-c", command], {
		cwd,
		env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		timeout: HOOK_TIMEOUT_MS,
	});
	proc.stdin.write(JSON.stringify(input));
	await proc.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout, stderr };
}
