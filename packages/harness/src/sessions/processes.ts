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

/** `/proc/<pid>/stat`: state and start time (clock ticks since boot). */
function probeProc(pid: number): ProcessState | undefined {
	let stat: string;
	try {
		stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	} catch {
		return undefined;
	}
	// Fields after the parenthesised command name: state is field 3 and
	// starttime field 22 of the whole line.
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	if (fields[0] === "Z" || fields[0] === "X") return { state: "gone" };
	return { state: "running", start: fields[19] ?? null };
}

/** `ps`, where there is no `/proc` (macOS). */
function probePs(pid: number): ProcessState {
	const ps = Bun.spawnSync(["ps", "-o", "stat=,lstart=", "-p", String(pid)], {
		env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" },
	});
	const line = ps.stdout.toString().trim();
	if (line === "") return { state: "gone" };
	const [stat = "", ...start] = line.split(/\s+/);
	if (stat.startsWith("Z")) return { state: "gone" };
	return { state: "running", start: start.length > 0 ? start.join(" ") : null };
}

function exists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM: it runs, as somebody else.
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

export const systemProcesses: ProcessTable = {
	self: process.pid,
	probe: (pid) => {
		// pid 1 runs (a container's entrypoint may be the harness itself); only
		// signalling it is off limits, in `signalGroup`.
		if (!Number.isInteger(pid) || pid < 1 || !exists(pid)) {
			return { state: "gone" };
		}
		return probeProc(pid) ?? probePs(pid);
	},
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
