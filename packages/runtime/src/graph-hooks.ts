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
 * edits). Different roots sync independently. The root is looked up off the
 * caller's turn (an async git probe), so an event never delays the gate's
 * answer. A sync never rejects; failures go to `onError`.
 *
 * A sync that loses the store's write race to another writer every time
 * (`{ kind: "conflict" }`) is queued again, folded into whatever work
 * arrived meanwhile, so its paths are not left stale until the next event.
 * A run of conflicts is bounded (`conflictRetries`); once it is spent the
 * conflict goes to `onError` and the work is dropped.
 *
 * Event shape (spec §6.2): the event's `root` (in `input.root`) or else its
 * `cwd` names the directory, and a post-action carries
 * `input.action = { kind, path | paths }`, relative paths being relative to
 * that directory.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	type GraphStoreError,
	type GraphStorePorts,
	type GraphSyncReport,
	indexRepo,
	type OpenCodeGraphError,
	openCodeGraph,
	type Result,
	updateFiles,
} from "@mainahq/core";
import type { GateEvent } from "./gate";
import { asyncGitProbe, resolveRootAsync } from "./root";

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

/** Why a root's graph could not be brought up to date. */
export type GraphSyncError = OpenCodeGraphError | GraphStoreError;

export type GraphSyncResult = Result<void, GraphSyncError>;

export type GraphSyncPorts = Readonly<{
	/** The repository root containing `dir`, or null outside one. */
	rootOf: (dir: string) => Promise<string | null>;
	/** Brings the root's whole graph up to date. */
	syncAll: (root: string) => Promise<GraphSyncResult>;
	/** Brings only these absolute paths (and their dependents) up to date. */
	syncPaths: (
		root: string,
		paths: readonly string[],
	) => Promise<GraphSyncResult>;
}>;

type GraphSyncOptions = Readonly<{
	/** A failed sync (`GraphSyncError`) or a port that threw or rejected. */
	onError?: (root: string, error: unknown) => void;
	/**
	 * How many times in a row a root's conflicted sync is queued again
	 * before the conflict is reported and the work dropped. Default 3.
	 */
	conflictRetries?: number;
}>;

const DEFAULT_CONFLICT_RETRIES = 3;

type GraphSync = Readonly<{
	/**
	 * Starts the sync an event asks for, or joins the one queued for its
	 * root. Returns at once and resolves once that sync has finished (or at
	 * once when the event names no repository); never rejects. Null when the
	 * event asks for nothing.
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

	const conflictRetries = options.conflictRetries ?? DEFAULT_CONFLICT_RETRIES;

	/** Runs one job: the sync's error, or null once it is done or reported. */
	const runJob = async (
		root: string,
		job: Pending,
	): Promise<GraphSyncError | null> => {
		try {
			const synced = job.full
				? await ports.syncAll(root)
				: await ports.syncPaths(root, [...job.paths].sort());
			return synced.ok ? null : synced.error;
		} catch (error) {
			options.onError?.(root, error);
			return null;
		}
	};

	/** Folds a conflicted job into the lane's next one; it settles with it. */
	const requeue = (lane: Lane, job: Pending): void => {
		const retry = lane.pending ?? newPending();
		lane.pending = retry;
		if (job.full) retry.full = true;
		for (const path of job.paths) retry.paths.add(path);
		void retry.done.then(job.resolve);
	};

	const drain = async (root: string, lane: Lane): Promise<void> => {
		lane.running = true;
		// Conflicted runs in a row; the budget resets once a run is not one.
		let conflicts = 0;
		while (lane.pending !== null) {
			const job = lane.pending;
			lane.pending = null;
			const error = await runJob(root, job);
			if (error?.kind === "conflict" && conflicts < conflictRetries) {
				conflicts++;
				requeue(lane, job);
				continue;
			}
			conflicts = 0;
			if (error !== null) options.onError?.(root, error);
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

	const start = async (trigger: GraphTrigger): Promise<void> => {
		let root: string | null;
		try {
			root = await ports.rootOf(trigger.dir);
		} catch (error) {
			options.onError?.(trigger.dir, error);
			return;
		}
		if (root !== null) await enqueue(root, trigger);
	};

	return {
		observe: (event) => {
			const trigger = graphTrigger(event);
			return trigger === null ? null : start(trigger);
		},
	};
}

/** `path` with symlinks resolved; a deleted file keeps its resolved parent. */
export function realPath(path: string): string {
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
 * Real ports: roots come from git (FR-INS-3) through the async probe, and
 * the store is the one under the root's `.maina/graph/`. A repository maina
 * was never set up in (no `.maina/`) is left alone, so a hook never creates
 * `.maina/` itself.
 */
export function systemGraphSyncPorts(): GraphSyncPorts {
	const withStore = async (
		root: string,
		run: (
			ports: GraphStorePorts,
		) => Promise<Result<GraphSyncReport, GraphStoreError>>,
	): Promise<GraphSyncResult> => {
		const mainaDir = join(root, ".maina");
		if (!existsSync(mainaDir)) return { ok: true, value: undefined };
		const opened = openCodeGraph(mainaDir);
		if (!opened.ok) return opened;
		try {
			const synced = await run(opened.value.ports);
			return synced.ok ? { ok: true, value: undefined } : synced;
		} finally {
			opened.value.close();
		}
	};
	return {
		rootOf: async (dir) => {
			const root = await resolveRootAsync({ cwd: dir }, asyncGitProbe);
			return root.ok ? root.value.path : null;
		},
		syncAll: (root) => withStore(root, (ports) => indexRepo(ports, root)),
		// git reports the root with symlinks resolved; hosts may not.
		syncPaths: (root, paths) =>
			withStore(root, (ports) => updateFiles(ports, root, paths.map(realPath))),
	};
}
