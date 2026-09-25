/**
 * Cross-file resolution: turns one file's parsed facts into edges, by
 * looking names up in its own nodes, its imports and (for Go and Java) its
 * package. Pure over a `GraphView`.
 *
 * Incrementality rests on one invariant: resolution is deterministic and
 * asks about the rest of the repo only through the view. `recording` wraps
 * the view and keeps a key for every question asked. The answer to a
 * question can only change when a file under its key changes, so a file
 * whose keys all miss the changed paths would resolve to the same edges, and
 * need not be touched. `changeKeys` names the keys a changed path can affect.
 */

import type { Lang } from "../parse/types";
import {
	type Binding,
	baseName,
	dirOf,
	type GraphView,
	resolveImport,
} from "./modules";
import type { EdgeKind, GraphEdge, GraphNode, StoredFacts } from "./schema";

type Resolution = Readonly<{
	edges: readonly GraphEdge[];
	/** Every view key the resolution depended on, sorted. */
	deps: readonly string[];
}>;

const pathKey = (path: string): string => `p:${path}`;
const dirKey = (dir: string): string => `d:${dir}`;
const dirNameKey = (name: string): string => `n:${name}`;
const baseKey = (base: string): string => `b:${base}`;

/** A view that records a dependency key for every question it answers. */
function recording(view: GraphView, deps: Set<string>): GraphView {
	return {
		has: (path) => {
			deps.add(pathKey(path));
			return view.has(path);
		},
		filesIn: (dir) => {
			deps.add(dirKey(dir));
			return view.filesIn(dir);
		},
		dirsNamed: (name) => {
			deps.add(dirNameKey(name));
			return view.dirsNamed(name);
		},
		withBase: (base) => {
			deps.add(baseKey(base));
			return view.withBase(base);
		},
		nodesIn: (path) => {
			deps.add(pathKey(path));
			return view.nodesIn(path);
		},
	};
}

/** The dependency keys whose answers a change to `path` (edit, add or delete) can alter. */
export function changeKeys(path: string): readonly string[] {
	const dir = dirOf(path);
	return [
		pathKey(path),
		dirKey(dir),
		dirNameKey(baseName(dir)),
		baseKey(baseName(path)),
	];
}

const NOT_SYMBOLS: ReadonlySet<string> = new Set(["file", "test", "suite"]);
const TYPE_KINDS: ReadonlySet<string> = new Set([
	"class",
	"struct",
	"interface",
	"trait",
	"enum",
	"type",
]);
const SELF_RECEIVERS: ReadonlySet<string> = new Set(["this", "self", "Self"]);

const isSymbol = (n: GraphNode): boolean => !NOT_SYMBOLS.has(n.kind);

/** Rust makes a parent's private items visible to its child modules; elsewhere only exports cross files. */
const crossFileNeedsExport = (lang: Lang): boolean => lang !== "rust";

/** Go and Java share one namespace across the files of a directory (package). */
const sharesPackage = (lang: Lang): boolean => lang === "go" || lang === "java";

type Scope = Readonly<{
	named: ReadonlyMap<string, Extract<Binding, { kind: "named" }>>;
	namespaces: ReadonlyMap<string, readonly string[]>;
	globs: readonly string[];
}>;

function buildScope(bindings: readonly Binding[]): Scope {
	const named = new Map<string, Extract<Binding, { kind: "named" }>>();
	const namespaces = new Map<string, readonly string[]>();
	const globs: string[] = [];
	for (const b of bindings) {
		// The first binding of a local name wins, like a duplicate-import error would.
		if (b.kind === "named" && !named.has(b.local)) named.set(b.local, b);
		else if (b.kind === "namespace" && !namespaces.has(b.local)) {
			namespaces.set(b.local, b.files);
		} else if (b.kind === "glob") globs.push(...b.files);
	}
	return { named, namespaces, globs: [...new Set(globs)] };
}

/**
 * Resolves the file at `path`. `nodes` are its own nodes (as written by
 * `upsert`), `facts` its stored parse.
 */
export function resolveFile(
	path: string,
	lang: Lang,
	facts: StoredFacts,
	nodes: readonly GraphNode[],
	baseView: GraphView,
): Resolution {
	const deps = new Set<string>();
	const view = recording(baseView, deps);
	const needsExport = crossFileNeedsExport(lang);
	const edges = new Map<string, GraphEdge>();
	const addEdge = (src: string, dst: string, kind: EdgeKind): void => {
		if (src === dst) return;
		const key = `${src}\0${dst}\0${kind}`;
		if (!edges.has(key)) edges.set(key, { src, dst, kind, path });
	};

	const scopeIds = new Map<string, string>();
	for (const n of nodes) {
		if (n.kind !== "file" && !scopeIds.has(n.qualifiedName)) {
			scopeIds.set(n.qualifiedName, n.id);
		}
	}
	const sourceId = (scope: string | null): string =>
		(scope === null ? undefined : scopeIds.get(scope)) ?? path;

	// Imports first: they are edges in their own right and define the scope.
	const bindings: Binding[] = [];
	for (const imp of facts.imports) {
		const resolved = resolveImport(path, lang, imp, view);
		for (const file of resolved.files) addEdge(path, file, "imports");
		bindings.push(...resolved.bindings);
	}
	const scope = buildScope(bindings);

	const peers = (): readonly string[] =>
		sharesPackage(lang)
			? view
					.filesIn(dirOf(path))
					.filter(
						(f) => f !== path && f.endsWith(lang === "go" ? ".go" : ".java"),
					)
			: [];

	const topLevel = (
		candidates: readonly GraphNode[],
		name: string,
		exportedOnly: boolean,
	): GraphNode | undefined =>
		candidates.find(
			(n) =>
				isSymbol(n) &&
				n.parent === null &&
				n.name === name &&
				(!exportedOnly || n.exported),
		);
	const member = (
		candidates: readonly GraphNode[],
		parent: string,
		name: string,
		exportedOnly: boolean,
	): GraphNode | undefined =>
		candidates.find(
			(n) =>
				isSymbol(n) &&
				n.parent === parent &&
				n.name === name &&
				(!exportedOnly || n.exported),
		);
	const firstIn = (
		files: readonly string[],
		pick: (candidates: readonly GraphNode[]) => GraphNode | undefined,
	): GraphNode | undefined => {
		for (const file of files) {
			const hit = pick(view.nodesIn(file));
			if (hit !== undefined) return hit;
		}
		return undefined;
	};

	const enclosingType = (scopeName: string | null): string | null => {
		const node = nodes.find(
			(n) => isSymbol(n) && n.qualifiedName === scopeName,
		);
		if (node === undefined) return null;
		if (node.parent !== null) return node.parent;
		return TYPE_KINDS.has(node.kind) ? node.qualifiedName : null;
	};

	/** A bare name: local, then imported by name, then star imports, then the package. */
	const resolveName = (name: string): GraphNode | undefined => {
		const local = topLevel(nodes, name, false);
		if (local !== undefined) return local;
		const named = scope.named.get(name);
		if (named !== undefined) {
			const parent = named.parent;
			const hit = firstIn(named.files, (c) =>
				parent === null
					? topLevel(c, named.name, needsExport)
					: member(c, parent, named.name, needsExport),
			);
			if (hit !== undefined) return hit;
		}
		return (
			firstIn(scope.globs, (c) => topLevel(c, name, needsExport)) ??
			firstIn(peers(), (c) => topLevel(c, name, false))
		);
	};

	/** `receiver.name`: a method of this type, a local type, a module, an imported type, a package type. */
	const resolveMember = (
		receiver: string,
		name: string,
		scopeName: string | null,
	): GraphNode | undefined => {
		if (SELF_RECEIVERS.has(receiver)) {
			const owner = enclosingType(scopeName);
			return owner === null ? undefined : member(nodes, owner, name, false);
		}
		if (topLevel(nodes, receiver, false) !== undefined) {
			return member(nodes, receiver, name, false);
		}
		const namespace = scope.namespaces.get(receiver);
		if (namespace !== undefined) {
			return firstIn(namespace, (c) => topLevel(c, name, needsExport));
		}
		const named = scope.named.get(receiver);
		if (named !== undefined && named.parent === null) {
			return firstIn(named.files, (c) =>
				member(c, named.name, name, needsExport),
			);
		}
		return (
			firstIn(peers(), (c) => member(c, receiver, name, false)) ??
			firstIn(scope.globs, (c) => member(c, receiver, name, needsExport))
		);
	};

	for (const call of facts.calls) {
		const target =
			call.receiver !== null
				? resolveMember(call.receiver, call.name, call.scope)
				: call.member
					? undefined
					: resolveName(call.name);
		if (target !== undefined) addEdge(sourceId(call.scope), target.id, "calls");
	}

	for (const ref of facts.refs) {
		const parts = ref.name.split(/\.|::/);
		const name = parts.at(-1) ?? ref.name;
		const target =
			parts.length > 1
				? resolveMember(parts.slice(0, -1).join("."), name, ref.scope)
				: resolveName(name);
		if (target !== undefined) {
			addEdge(
				sourceId(ref.scope),
				target.id,
				ref.kind === "inherit" ? "inherits" : "references",
			);
		}
	}

	return {
		edges: [...edges.values()],
		deps: [...deps].sort(),
	};
}
