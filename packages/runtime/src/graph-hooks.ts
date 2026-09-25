/**
 * Graph hooks (FR-GRAPH-2).
 *
 * The runtime keeps each repository's code graph current from host events,
 * so the context engine never has to walk the repository:
 *
 * - `session.start` brings the whole root up to date. The store is
 *   incremental by content hash, so only files changed since the last sync
 *   are parsed.
 * - `action.post` for a file edit (`file.write`, `file.edit`) updates just
 *   the edited paths and the files that depend on them.
 *
 * Syncs are single flight per root: while one runs, later events for that
 * root are coalesced into the next sync (a pending full sync covers pending
 * edits). Different roots sync independently. A sync never rejects and
 * never delays the gate's answer; failures go to `onError`.
 *
 * Event shape (spec §6.2): the event's `root` (in `input.root`) or else its
 * `cwd` names the directory, and a post-action carries
 * `input.action = { kind, path | paths }`, relative paths being relative to
 * that directory.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { indexRepo, openCodeGraph, updateFiles } from "@mainahq/core";
import type { GateEvent } from "./gate";
import { gitProbe, resolveRoot } from "./root";

type GraphTrigger =
	| Readonly<{ kind: "session"; dir: string }>
	| Readonly<{ kind: "edit"; dir: string; paths: readonly string[] }>;

/** Action kinds that change a file's content. */
const FILE_EDITS: ReadonlySet<string> = new Set(["file.write", "file.edit"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
	typeof value === "string" && value !== "";

function eventDir(event: GateEvent): string | null {
	const root = event.input.root;
	if (nonEmpty(root)) return root;
	return nonEmpty(event.cwd) ? event.cwd : null;
}

function editedPaths(action: Record<string, unknown>): readonly string[] {
	const { path, paths } = action;
	const listed = Array.isArray(paths) ? paths.filter(nonEmpty) : [];
	return nonEmpty(path) ? [path, ...listed] : listed;
}

/** What an event asks of the graph, or null for nothing. Pure. */
export function graphTrigger(event: GateEvent): GraphTrigger | null {
	const dir = eventDir(event);
	if (dir === null) return null;
	if (event.kind === "session.start") return { kind: "session", dir };
	if (event.kind !== "action.post") return null;
	const action = event.input.action;
	if (!isRecord(action) || typeof action.kind !== "string") return null;
	if (!FILE_EDITS.has(action.kind)) return null;
	const paths = editedPaths(action).map((p) => resolve(dir, p));
	return paths.length > 0 ? { kind: "edit", dir, paths } : null;
}

export type GraphSyncPorts = Readonly<{
	/** The repository root containing `dir`, or null outside one. */
	rootOf: (dir: string) => string | null;
	/** Brings the root's whole graph up to date. */
	syncAll: (root: string) => Promise<void>;
	/** Brings only these absolute paths (and their dependents) up to date. */
	syncPaths: (root: string, paths: readonly string[]) => Promise<void>;
}>;

type GraphSyncOptions = Readonly<{
	onError?: (root: string, error: unknown) => void;
}>;

type GraphSync = Readonly<{
	/**
	 * Starts the sync an event asks for, or joins the one queued for its
	 * root. Resolves once that sync has finished; never rejects. Null when
	 * the event asks for nothing or names no repository.
	 */
	observe: (event: GateEvent) => Promise<void> | null;
}>;

/** Work queued for a root behind the running sync. */
type Pending = {
	full: boolean;
	paths: Set<string>;
	done: Promise<void>;
	resolve: () => void;
};

type Lane = { running: boolean; pending: Pending | null };

function newPending(): Pending {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { full: false, paths: new Set(), done: promise, resolve };
}

export function createGraphSync(
	ports: GraphSyncPorts,
	options: GraphSyncOptions = {},
): GraphSync {
	const lanes = new Map<string, Lane>();

	const runJob = async (root: string, job: Pending): Promise<void> => {
		try {
			if (job.full) await ports.syncAll(root);
			else await ports.syncPaths(root, [...job.paths].sort());
		} catch (error) {
			options.onError?.(root, error);
		}
	};

	const drain = async (root: string, lane: Lane): Promise<void> => {
		lane.running = true;
		while (lane.pending !== null) {
			const job = lane.pending;
			lane.pending = null;
			await runJob(root, job);
			job.resolve();
		}
		lane.running = false;
		lanes.delete(root);
	};

	const enqueue = (root: string, trigger: GraphTrigger): Promise<void> => {
		const lane = lanes.get(root) ?? { running: false, pending: null };
		lanes.set(root, lane);
		const job = lane.pending ?? newPending();
		lane.pending = job;
		if (trigger.kind === "session") job.full = true;
		else for (const path of trigger.paths) job.paths.add(path);
		if (!lane.running) void drain(root, lane);
		return job.done;
	};

	return {
		observe: (event) => {
			const trigger = graphTrigger(event);
			if (trigger === null) return null;
			let root: string | null;
			try {
				root = ports.rootOf(trigger.dir);
			} catch (error) {
				options.onError?.(trigger.dir, error);
				return null;
			}
			return root === null ? null : enqueue(root, trigger);
		},
	};
}

/** `path` with symlinks resolved; a deleted file keeps its resolved parent. */
function realPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		try {
			return join(realpathSync(dirname(path)), basename(path));
		} catch {
			return path;
		}
	}
}

/**
 * Real ports: roots come from git (FR-INS-3), and the store is the one
 * under the root's `.maina/graph/`. A repository maina was never set up in
 * (no `.maina/`) is left alone, so a hook never creates `.maina/` itself.
 */
export function systemGraphSyncPorts(): GraphSyncPorts {
	const withStore = async (
		root: string,
		run: (
			ports: Parameters<typeof indexRepo>[0],
		) => ReturnType<typeof indexRepo>,
	): Promise<void> => {
		const mainaDir = join(root, ".maina");
		if (!existsSync(mainaDir)) return;
		const opened = openCodeGraph(mainaDir);
		if (!opened.ok) throw new Error(opened.error.message);
		try {
			const synced = await run(opened.value.ports);
			if (!synced.ok) throw new Error(JSON.stringify(synced.error));
		} finally {
			opened.value.close();
		}
	};
	return {
		rootOf: (dir) => {
			const root = resolveRoot({ cwd: dir }, gitProbe);
			return root.ok ? root.value.path : null;
		},
		syncAll: (root) => withStore(root, (ports) => indexRepo(ports, root)),
		// git reports the root with symlinks resolved; hosts may not.
		syncPaths: (root, paths) =>
			withStore(root, (ports) => updateFiles(ports, root, paths.map(realPath))),
	};
}
