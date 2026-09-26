/**
 * Which processes a session holds, told apart from strangers (FR-HAR-6).
 *
 * A lease records the pid of the process that owns a run and of every PTY
 * it started, each with the process's start time. A pid alone is not an
 * identity: once a crashed worker's PTY has exited the kernel may hand its
 * pid to anything, and a reclaim that signalled a bare pid could kill an
 * unrelated program. So a process is "ours" only while its pid and start
 * time both match; a mismatch means ours is gone, and a start time that
 * cannot be read means nobody can tell, which never counts as dead.
 *
 * `systemProcesses` is the one adapter over the real process table; tests
 * swap `self` to impersonate another owner.
 */

import { readFileSync } from "node:fs";

export type ProcessState =
	| Readonly<{ state: "gone" }>
	/** `start` is null when the start time could not be read. */
	| Readonly<{ state: "running"; start: string | null }>;

/** A process as a lease records it. */
export type ProcessIdentity = Readonly<{ pid: number; start: string | null }>;

export type ProcessTable = Readonly<{
	/** The pid a new lease names as its owner: this process, normally. */
	self: number;
	/** Whether `pid` runs, and since when. A zombie is gone. */
	probe: (pid: number) => ProcessState;
	/** Signals every process in group `pgid`. Never throws. */
	signalGroup: (pgid: number, signal: NodeJS.Signals) => void;
}>;

/** What `probe` reads from the system; tests swap it. */
export type ProbeIo = Readonly<{
	/** Whether kill(pid, 0) finds the pid (EPERM counts: it runs as somebody else). */
	exists: (pid: number) => boolean;
	/** `/proc/<pid>/stat`, or undefined when it cannot be read. */
	procStat: (pid: number) => string | undefined;
	/** `ps -o stat=,lstart=` output for the pid, or undefined when ps cannot run. */
	ps: (pid: number) => string | undefined;
}>;

/** `/proc/<pid>/stat`: state and start time (clock ticks since boot). */
function parseProcStat(stat: string): ProcessState {
	// Fields after the parenthesised command name: state is field 3 and
	// starttime field 22 of the whole line.
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	if (fields[0] === "Z" || fields[0] === "X") return { state: "gone" };
	return { state: "running", start: fields[19] ?? null };
}

/** A `ps` line, where there is no `/proc` (macOS); undefined when empty. */
function parsePs(line: string): ProcessState | undefined {
	if (line === "") return undefined;
	const [stat = "", ...start] = line.split(/\s+/);
	if (stat.startsWith("Z")) return { state: "gone" };
	return { state: "running", start: start.length > 0 ? start.join(" ") : null };
}

/**
 * Whether `pid` runs, and since when. Only kill(0) failing to find the pid,
 * or a zombie, counts as gone: a pid kill(0) finds but neither `/proc` nor
 * `ps` can show (`/proc` mounted `hidepid`, no `ps`) runs with an unknown
 * start time, which never reads as crashed.
 */
export function probeWith(io: ProbeIo, pid: number): ProcessState {
	// pid 1 runs (a container's entrypoint may be the harness itself); only
	// signalling it is off limits, in `signalGroup`.
	if (!Number.isInteger(pid) || pid < 1 || !io.exists(pid)) {
		return { state: "gone" };
	}
	const stat = io.procStat(pid);
	if (stat !== undefined) return parseProcStat(stat);
	const line = io.ps(pid);
	const shown = line === undefined ? undefined : parsePs(line.trim());
	return shown ?? { state: "running", start: null };
}

const systemProbeIo: ProbeIo = {
	exists: (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch (e) {
			return (e as NodeJS.ErrnoException).code === "EPERM";
		}
	},
	procStat: (pid) => {
		try {
			return readFileSync(`/proc/${pid}/stat`, "utf8");
		} catch {
			return undefined;
		}
	},
	ps: (pid) => {
		try {
			const ps = Bun.spawnSync(
				["ps", "-o", "stat=,lstart=", "-p", String(pid)],
				{ env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" } },
			);
			return ps.stdout.toString();
		} catch {
			return undefined;
		}
	},
};

export const systemProcesses: ProcessTable = {
	self: process.pid,
	probe: (pid) => probeWith(systemProbeIo, pid),
	signalGroup: (pgid, signal) => {
		if (!Number.isInteger(pgid) || pgid <= 1) return;
		try {
			process.kill(-pgid, signal);
		} catch {
			// Already gone.
		}
	},
};

export function identify(table: ProcessTable, pid: number): ProcessIdentity {
	const probed = table.probe(pid);
	return { pid, start: probed.state === "running" ? probed.start : null };
}

/**
 * Whether the process a lease recorded still runs: `same` (pid and start
 * time match), `gone` (no such pid, or the pid now belongs to another
 * process) or `unknown` (a start time is missing on either side).
 */
export function liveness(
	table: ProcessTable,
	id: ProcessIdentity,
): "same" | "gone" | "unknown" {
	const probed = table.probe(id.pid);
	if (probed.state === "gone") return "gone";
	if (probed.start === null || id.start === null) return "unknown";
	return probed.start === id.start ? "same" : "gone";
}

const POLL_MS = 25;

/**
 * Stops the process group led by `id`, if it is still ours: SIGTERM, then
 * SIGKILL once the leader outlives `graceMs` (and to the group regardless,
 * for children that shrugged off SIGTERM). Returns whether it signalled.
 */
export async function stopGroup(
	table: ProcessTable,
	id: ProcessIdentity,
	graceMs: number,
): Promise<boolean> {
	if (liveness(table, id) !== "same") return false;
	table.signalGroup(id.pid, "SIGTERM");
	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline && liveness(table, id) === "same") {
		await Bun.sleep(POLL_MS);
	}
	table.signalGroup(id.pid, "SIGKILL");
	return true;
}
