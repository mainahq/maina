/**
 * The agent's child process (FR-HAR-1): the harness's only process edge.
 *
 * `spawnAgent` starts an ACP agent with the workspace root as its working
 * directory and exposes its stdio as web streams for the SDK's ndjson
 * transport. `stop` ends it for good: close stdin, SIGTERM, then SIGKILL
 * once the grace period runs out, and resolve only when it has exited, so a
 * finished or cancelled run never leaves an agent behind.
 */

import type { Result } from "@mainahq/core";
import type { HarnessError } from "./events";

/** An ACP agent to run: `claude-code-acp`, `codex-acp`, `gemini --experimental-acp`, ... */
export type AgentSpec = Readonly<{
	/** Short name, for events and the gate's `host` (`acp:<name>`). */
	name: string;
	command: string;
	args?: readonly string[];
	/** Added to the inherited environment. */
	env?: Readonly<Record<string, string>>;
}>;

export type AgentProcess = Readonly<{
	pid: number;
	/** The agent's stdin. */
	input: WritableStream<Uint8Array>;
	/** The agent's stdout. */
	output: ReadableStream<Uint8Array>;
	/** Resolves with the exit code once the agent has exited. */
	exited: Promise<number | null>;
	/** The last few KB the agent wrote to stderr, for error messages. */
	stderrTail: () => string;
	/** Ends the agent (TERM, then KILL after `graceMs`) and waits for it. */
	stop: (graceMs: number) => Promise<void>;
}>;

export type SpawnAgent = (
	agent: AgentSpec,
	root: string,
) => Result<AgentProcess, HarnessError>;

const STDERR_TAIL = 4096;

export const spawnAgent: SpawnAgent = (agent, root) => {
	let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
	try {
		child = Bun.spawn([agent.command, ...(agent.args ?? [])], {
			cwd: root,
			env: agent.env === undefined ? undefined : { ...Bun.env, ...agent.env },
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (e) {
		return {
			ok: false,
			error: {
				code: "spawn_failed",
				message: `could not start agent "${agent.name}" (${agent.command}): ${e instanceof Error ? e.message : String(e)}`,
			},
		};
	}

	let tail = "";
	// Drains stderr so the agent never blocks on it; a broken pipe only
	// loses diagnostics.
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child.stderr) {
			tail = (tail + decoder.decode(chunk, { stream: true })).slice(
				-STDERR_TAIL,
			);
		}
	})().catch(() => undefined);

	const stdin = child.stdin;
	const input = new WritableStream<Uint8Array>({
		async write(chunk) {
			stdin.write(chunk);
			await stdin.flush();
		},
		async close() {
			await stdin.end();
		},
	});

	let exitCode: number | null | undefined;
	const exited = child.exited.then((code) => {
		exitCode = code;
		return code;
	});

	const stop = async (graceMs: number): Promise<void> => {
		if (exitCode !== undefined) return;
		try {
			await stdin.end();
		} catch {
			// Already closed: the agent is on its way out.
		}
		child.kill("SIGTERM");
		const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
		await exited;
		clearTimeout(timer);
	};

	return {
		ok: true,
		value: {
			pid: child.pid,
			input,
			output: child.stdout,
			exited,
			stderrTail: () => tail.trim(),
			stop,
		},
	};
};
