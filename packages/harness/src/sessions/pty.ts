/**
 * A command on a pseudo-terminal (FR-HAR-6), for agents and tools that
 * only behave on a real TTY. Bun's built-in PTY does the work; there is no
 * third-party session manager.
 *
 * The child leads its own session and process group, so `stop` reaches
 * everything it started. Given the run's `worktree`, `spawnPty` records the
 * child (pid and start time) in the run's lease before returning, so a PTY
 * orphaned by a crashed worker can still be found and stopped by `reclaim`;
 * if that record cannot be written the child is killed and the spawn fails,
 * because a PTY nobody can find again must not run.
 */

import { statSync } from "node:fs";
import { type Result, stripRepoLocalGitEnv } from "@mainahq/core";
import type { AgentSpec } from "../worker";
import { recordPty, type SessionError } from "./lease";
import { identify, type ProcessTable, systemProcesses } from "./processes";
import type { Worktree } from "./worktree";

export type PtyOptions = Readonly<{
	cols?: number;
	rows?: number;
	/** The run the PTY belongs to: it is recorded in the run's lease. */
	worktree?: Worktree;
	/** Every chunk the command writes, as it arrives. */
	onData?: (chunk: Uint8Array) => void;
	processes?: ProcessTable;
}>;

export type PtySession = Readonly<{
	pid: number;
	/** Types into the terminal. */
	write: (data: string | Uint8Array) => void;
	resize: (cols: number, rows: number) => void;
	/** The last 64 KB the command wrote, decoded. */
	output: () => string;
	/** Resolves with the exit code once the command has exited and its output is read. */
	exited: Promise<number | null>;
	/** Ends the process group (TERM, then KILL after `graceMs`) and waits for it. */
	stop: (graceMs: number) => Promise<void>;
}>;

const OUTPUT_TAIL = 64 * 1024;
/** How long `exited` waits for the terminal to drain after the command exits. */
const DRAIN_MS = 250;

function spawnFailed(command: AgentSpec, e: unknown): SessionError {
	return {
		code: "spawn_failed",
		message: `could not start ${command.name} (${command.command}) on a PTY: ${e instanceof Error ? e.message : String(e)}`,
	};
}

/** Why `command` cannot start in `cwd`, or undefined when it can. */
function checkStartable(
	command: AgentSpec,
	cwd: string,
	path: string | undefined,
): string | undefined {
	let isDirectory: boolean;
	try {
		isDirectory =
			statSync(cwd, { throwIfNoEntry: false })?.isDirectory() ?? false;
	} catch {
		// ENOTDIR, EACCES: not a directory this process can start in.
		isDirectory = false;
	}
	if (!isDirectory) return `no directory ${cwd}`;
	return Bun.which(command.command, { cwd, PATH: path ?? "" }) === null
		? `no executable ${command.command}`
		: undefined;
}

export function spawnPty(
	command: AgentSpec,
	cwd: string,
	options: PtyOptions = {},
): Result<PtySession, SessionError> {
	const processes = options.processes ?? systemProcesses;
	const decoder = new TextDecoder();
	let tail = "";
	let drained: () => void = () => undefined;
	const eof = new Promise<void>((resolve) => {
		drained = resolve;
	});

	// The run's git must read its own worktree, never a repository a
	// surrounding git hook exported.
	const env = { ...stripRepoLocalGitEnv(Bun.env), ...command.env };
	// Bun 1.3 crashes, rather than throws, when a PTY spawn fails: check
	// what would fail first.
	const unstartable = checkStartable(command, cwd, env.PATH);
	if (unstartable !== undefined) {
		return { ok: false, error: spawnFailed(command, unstartable) };
	}

	let child: Bun.Subprocess;
	try {
		child = Bun.spawn([command.command, ...(command.args ?? [])], {
			cwd,
			env,
			terminal: {
				cols: options.cols ?? 120,
				rows: options.rows ?? 40,
				data: (_terminal, chunk) => {
					tail = (tail + decoder.decode(chunk, { stream: true })).slice(
						-OUTPUT_TAIL,
					);
					options.onData?.(chunk);
				},
				exit: () => drained(),
			},
		});
	} catch (e) {
		return { ok: false, error: spawnFailed(command, e) };
	}
	const terminal = child.terminal;
	const pid = child.pid;

	let exitCode: number | null | undefined;
	const exited = child.exited.then(async (code) => {
		exitCode = code;
		// A grandchild holding the terminal open must not hold `exited` up.
		await Promise.race([eof, Bun.sleep(DRAIN_MS)]);
		terminal?.close();
		return code;
	});

	const stop = async (graceMs: number): Promise<void> => {
		// Once the leader has exited (and been reaped) its pid may belong to
		// anyone: the group is signalled only while the leader still runs.
		if (exitCode === undefined) {
			processes.signalGroup(pid, "SIGTERM");
			const timer = setTimeout(
				() => processes.signalGroup(pid, "SIGKILL"),
				graceMs,
			);
			await child.exited;
			clearTimeout(timer);
			// Children that shrugged off SIGTERM outlive their leader.
			processes.signalGroup(pid, "SIGKILL");
		}
		await exited;
	};

	if (options.worktree !== undefined) {
		const recorded = recordPty(options.worktree, identify(processes, pid));
		if (!recorded.ok) {
			void stop(0);
			return recorded;
		}
	}

	return {
		ok: true,
		value: {
			pid,
			write: (data) => {
				terminal?.write(data);
			},
			resize: (cols, rows) => terminal?.resize(cols, rows),
			output: () => tail,
			exited,
			stop,
		},
	};
}
