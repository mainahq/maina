/**
 * Incremental code-graph store (v1 task 5.2, FR-GRAPH-2).
 *
 * `indexRepo` brings the store in line with the whole working tree;
 * `updateFiles` with just the paths a caller knows changed. Both run the same
 * sync, in two phases:
 *
 * 1. Read and hash each candidate file. A file whose content hash and grammar
 *    match the stored row is left alone. Otherwise its parse is taken from
 *    the content-hash cache (a rename or revert) or, failing that, parsed.
 * 2. In one transaction: drop deleted files, write changed files' nodes, then
 *    re-resolve the changed files plus every file that depended on them (see
 *    `resolve.ts`), and prune parses no file points at any more.
 *
 * The result is the same store a full rebuild into an empty database would
 * produce (the equivalence property test checks this), at the cost of
 * parsing only what changed.
 */
import { posix } from "node:path";
import { migrateGraphStore } from "../../db/graph-migrations";
import type { Result } from "../../db/index";
import type { DbPort } from "../../ports/index";
import { listIndexable } from "./list";
import { decodeEdge, decodeFile, decodeNode } from "./schema";
import { dbError, sync } from "./sync";
import type {
	GraphSnapshot,
	GraphStoreError,
	GraphStoreOptions,
	GraphStorePorts,
	GraphSyncReport,
} from "./types";

export type {
	EdgeKind,
	GraphEdge,
	GraphFile,
	GraphNode,
	NodeKind,
} from "./schema";
export type {
	GraphSnapshot,
	GraphStoreError,
	GraphStoreOptions,
	GraphStorePorts,
	GraphSyncReport,
} from "./types";

/** Repo-relative posix path, or null for a path outside `root`. */
function relativeTo(root: string, path: string): string | null {
	const slashed = path.replaceAll("\\", "/");
	const absolute = slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed);
	const rel = absolute
		? posix.relative(root.replaceAll("\\", "/"), slashed)
		: posix.normalize(slashed);
	if (rel === "" || rel === "." || rel.startsWith("../") || rel === "..") {
		return null;
	}
	return posix.isAbsolute(rel) ? null : rel;
}

/**
 * Indexes every indexable file under `root` (as git lists them, or by walking
 * the tree outside a repository) and drops stored files the listing no
 * longer covers.
 * Unchanged files are not parsed again.
 */
export async function indexRepo(
	ports: GraphStorePorts,
	root: string,
	options: GraphStoreOptions = {},
): Promise<Result<GraphSyncReport, GraphStoreError>> {
	const listed = await listIndexable(ports, root);
	if (!listed.ok) {
		return {
			ok: false,
			error: {
				kind: "fs",
				path: listed.error.path,
				message: listed.error.message,
			},
		};
	}
	const listedSet = new Set(listed.value);
	// A stored path the listing no longer covers (deleted, newly ignored, or
	// added by `updateFiles` outside the indexed set) is dropped, so the store
	// matches what a fresh index would build.
	return sync(
		ports,
		root,
		(stored) => ({
			examine: listed.value,
			drop: stored.filter((p) => !listedSet.has(p)).sort(),
		}),
		options,
	);
}

/**
 * Brings the given paths (absolute, or relative to `root`) up to date: new
 * and edited files are stored, missing ones removed, and files that depend
 * on any of them re-resolved. Paths outside `root` or without a grammar are
 * ignored.
 */
export async function updateFiles(
	ports: GraphStorePorts,
	root: string,
	paths: readonly string[],
	options: GraphStoreOptions = {},
): Promise<Result<GraphSyncReport, GraphStoreError>> {
	const relative = paths.flatMap((p) => {
		const rel = relativeTo(root, p);
		return rel === null ? [] : [rel];
	});
	return sync(
		ports,
		root,
		() => ({ examine: [...new Set(relative)].sort(), drop: [] }),
		options,
	);
}

/** The whole stored graph, each list sorted by its key. */
export function readGraph(db: DbPort): Result<GraphSnapshot, GraphStoreError> {
	const migrated = migrateGraphStore(db);
	if (!migrated.ok) return { ok: false, error: dbError(migrated.error) };
	const files = db.all("SELECT * FROM graph_files ORDER BY path");
	const nodes = db.all("SELECT * FROM graph_nodes ORDER BY path, ord");
	const edges = db.all("SELECT * FROM graph_edges ORDER BY src, dst, kind");
	if (!files.ok) return { ok: false, error: dbError(files.error) };
	if (!nodes.ok) return { ok: false, error: dbError(nodes.error) };
	if (!edges.ok) return { ok: false, error: dbError(edges.error) };
	return {
		ok: true,
		value: {
			files: files.value.map(decodeFile),
			nodes: nodes.value.map(decodeNode),
			edges: edges.value.map(decodeEdge),
		},
	};
}
