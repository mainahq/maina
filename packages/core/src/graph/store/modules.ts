/**
 * Import resolution: which indexed files an import statement points at, and
 * which local names it binds. Pure over a `GraphView`; every question about
 * the rest of the repo goes through the view so it can be recorded as a
 * dependency (see `resolve.ts`). Unresolvable imports (packages, the
 * standard library, other crates) bind nothing.
 */

import { posix } from "node:path";
import { detectLang, isTestPath } from "../parse/languages";
import type { Lang, ParsedImport } from "../parse/types";
import type { GraphNode } from "./schema";

/** Read-only questions resolution may ask about the indexed repo. */
export type GraphView = Readonly<{
	/** Whether `path` is an indexed file. */
	has: (path: string) => boolean;
	/** Indexed files directly inside `dir` (`""` is the root), sorted. */
	filesIn: (dir: string) => readonly string[];
	/** Directories holding indexed files whose last segment is `name`, sorted. */
	dirsNamed: (name: string) => readonly string[];
	/** Indexed files whose file name is `base`, sorted. */
	withBase: (base: string) => readonly string[];
	/** A file's nodes in source order; empty when it is not indexed. */
	nodesIn: (path: string) => readonly GraphNode[];
}>;

export type Binding =
	/** `local` names symbol `name` (a member of `parent` when set) in `files`. */
	| Readonly<{
			kind: "named";
			local: string;
			files: readonly string[];
			name: string;
			parent: string | null;
	  }>
	/** `local.x` names top-level `x` in `files`. */
	| Readonly<{ kind: "namespace"; local: string; files: readonly string[] }>
	/** Every top-level symbol of `files` is in scope. */
	| Readonly<{ kind: "glob"; files: readonly string[] }>;

type ImportResolution = Readonly<{
	files: readonly string[];
	bindings: readonly Binding[];
}>;

const NONE: ImportResolution = { files: [], bindings: [] };

export const dirOf = (path: string): string => {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
};

export const baseName = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1);

/** Joins and normalises; null when the result leaves the repo root. */
function joinPath(dir: string, rel: string): string | null {
	const joined = posix.normalize(dir === "" ? rel : `${dir}/${rel}`);
	if (joined === ".") return "";
	if (joined.startsWith("../") || joined === ".." || joined.startsWith("/")) {
		return null;
	}
	return joined.replace(/\/$/, "");
}

const under = (dir: string, name: string): string =>
	dir === "" ? name : `${dir}/${name}`;

/** `dir`, its parent, … up to the root `""`. */
function ancestors(dir: string): readonly string[] {
	const out: string[] = [dir];
	let current = dir;
	while (current !== "") {
		current = dirOf(current);
		out.push(current);
	}
	return out;
}

const firstIndexed = (
	view: GraphView,
	candidates: readonly string[],
): string | null => candidates.find((c) => view.has(c)) ?? null;

const lastSegment = (source: string, separator: string): string =>
	source.split(separator).at(-1) ?? source;

function unique(items: readonly string[]): readonly string[] {
	return [...new Set(items)];
}

function resolution(bindings: readonly Binding[]): ImportResolution {
	return { files: unique(bindings.flatMap((b) => b.files)), bindings };
}

// ── TypeScript / JavaScript ─────────────────────────────────────────────────

const JS_EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
];

/** ESM TypeScript imports the emitted name: `./a.js` means `./a.ts`. */
const JS_EMITTED: Readonly<Record<string, readonly string[]>> = {
	".js": [".ts", ".tsx"],
	".jsx": [".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
};

function jsModule(
	path: string,
	source: string,
	view: GraphView,
): string | null {
	if (!/^\.\.?(?:\/|$)/.test(source)) return null;
	const base = joinPath(dirOf(path), source);
	if (base === null) return null;
	const ext = JS_EXTENSIONS.find((e) => base.endsWith(e));
	const stem = ext === undefined ? base : base.slice(0, -ext.length);
	const exact =
		ext === undefined
			? []
			: [base, ...(JS_EMITTED[ext] ?? []).map((e) => `${stem}${e}`)];
	return firstIndexed(view, [
		...exact,
		...(base === "" ? [] : JS_EXTENSIONS.map((e) => `${base}${e}`)),
		...JS_EXTENSIONS.map((e) => under(base, `index${e}`)),
	]);
}

function jsImport(
	path: string,
	imp: ParsedImport,
	view: GraphView,
): ImportResolution {
	const target = jsModule(path, imp.source, view);
	if (target === null) return NONE;
	const files = [target];
	// `export … from` binds nothing locally; it is still a dependency.
	if (imp.kind === "reexport") return { files, bindings: [] };
	const bindings = imp.names.flatMap((b): Binding[] => {
		if (b.name === "*") {
			return b.alias === null
				? []
				: [{ kind: "namespace", local: b.alias, files }];
		}
		return [
			{
				kind: "named",
				local: b.alias ?? b.name,
				files,
				name: b.name,
				parent: null,
			},
		];
	});
	return { files, bindings };
}

// ── Python ──────────────────────────────────────────────────────────────────

function pyModule(
	path: string,
	source: string,
	view: GraphView,
): string | null {
	const dots = /^\.*/.exec(source)?.[0].length ?? 0;
	const segments = source.slice(dots).split(".").filter(Boolean).join("/");
	let roots: readonly string[];
	if (dots > 0) {
		const up = ancestors(dirOf(path))[dots - 1];
		if (up === undefined) return null;
		roots = [up];
	} else {
		// Absolute imports: the nearest enclosing directory that holds the module.
		roots = ancestors(dirOf(path));
	}
	for (const root of roots) {
		const rel = segments === "" ? root : under(root, segments);
		const found = firstIndexed(view, [
			...(segments === "" ? [] : [`${rel}.py`, `${rel}.pyi`]),
			under(rel, "__init__.py"),
			under(rel, "__init__.pyi"),
		]);
		if (found !== null) return found;
	}
	return null;
}

const pyChild = (source: string, name: string): string =>
	/^\.*$/.test(source) ? `${source}${name}` : `${source}.${name}`;

function pyImport(
	path: string,
	imp: ParsedImport,
	view: GraphView,
): ImportResolution {
	const module = (): string | null => pyModule(path, imp.source, view);
	const bindings = imp.names.flatMap((b): Binding[] => {
		if (b.name === "*") {
			const target = module();
			if (target === null) return [];
			// The parser records `import a.b` and `from a.b import *` alike. A
			// relative source can only be the star form; an absolute one is
			// read as the far more common `import a.b`, a namespace.
			return imp.source.startsWith(".")
				? [{ kind: "glob", files: [target] }]
				: [
						{
							kind: "namespace",
							local: b.alias ?? imp.source,
							files: [target],
						},
					];
		}
		const local = b.alias ?? b.name;
		const submodule = pyModule(path, pyChild(imp.source, b.name), view);
		if (submodule !== null)
			return [{ kind: "namespace", local, files: [submodule] }];
		const target = module();
		return target === null
			? []
			: [{ kind: "named", local, files: [target], name: b.name, parent: null }];
	});
	return resolution(bindings);
}

// ── Go ──────────────────────────────────────────────────────────────────────

/**
 * The package directory an import path names: the longest indexed directory
 * the import path ends with. Standard-library paths (no dot in the first
 * segment) are never local.
 */
function goPackage(source: string, view: GraphView): readonly string[] {
	if (!(source.split("/")[0] ?? "").includes(".")) return [];
	const dir = view
		.dirsNamed(lastSegment(source, "/"))
		.filter((d) => source === d || source.endsWith(`/${d}`))
		.sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0];
	if (dir === undefined) return [];
	return view
		.filesIn(dir)
		.filter((f) => detectLang(f) === "go" && !isTestPath(f, "go"));
}

/** A package is named after its last path segment, skipping a `/v2`-style major version. */
function goPackageName(source: string): string {
	const segments = source.split("/");
	const last = segments.at(-1) ?? source;
	const name =
		/^v\d+$/.test(last) && segments.length > 1
			? (segments.at(-2) ?? last)
			: last;
	return name.replace(/\.v\d+$/, "").replace(/^go-/, "");
}

function goImport(imp: ParsedImport, view: GraphView): ImportResolution {
	const files = goPackage(imp.source, view);
	if (files.length === 0) return NONE;
	const bindings = imp.names.flatMap((b): Binding[] => {
		if (b.alias === ".") return [{ kind: "glob", files }];
		if (b.alias === "_") return [];
		return [
			{ kind: "namespace", local: b.alias ?? goPackageName(imp.source), files },
		];
	});
	return { files, bindings };
}

// ── Java ────────────────────────────────────────────────────────────────────

const endsWithPath = (path: string, suffix: string): boolean =>
	path === suffix || path.endsWith(`/${suffix}`);

/** Source files declaring the class `a.b.C`, under any source root. */
function javaClass(dotted: string, view: GraphView): readonly string[] {
	const suffix = `${dotted.replaceAll(".", "/")}.java`;
	return view.withBase(baseName(suffix)).filter((p) => endsWithPath(p, suffix));
}

function javaPackage(dotted: string, view: GraphView): readonly string[] {
	const suffix = dotted.replaceAll(".", "/");
	return view
		.dirsNamed(lastSegment(dotted, "."))
		.filter((d) => endsWithPath(d, suffix))
		.flatMap((d) => view.filesIn(d).filter((f) => detectLang(f) === "java"));
}

function javaImport(imp: ParsedImport, view: GraphView): ImportResolution {
	const bindings = imp.names.flatMap((b): Binding[] => {
		if (b.name === "*") {
			const files = javaPackage(imp.source, view);
			return files.length === 0 ? [] : [{ kind: "glob", files }];
		}
		const local = b.alias ?? b.name;
		const cls = javaClass(`${imp.source}.${b.name}`, view);
		if (cls.length > 0) {
			return [{ kind: "named", local, files: cls, name: b.name, parent: null }];
		}
		// `import static a.B.member`: a member of class `B`.
		const owner = javaClass(imp.source, view);
		return owner.length === 0
			? []
			: [
					{
						kind: "named",
						local,
						files: owner,
						name: b.name,
						parent: lastSegment(imp.source, "."),
					},
				];
	});
	return resolution(bindings);
}

// ── Rust ────────────────────────────────────────────────────────────────────

const RUST_ROOTS = ["lib.rs", "main.rs"];

/** The directory holding a module file's child modules. */
function rustChildDir(file: string): string {
	const name = baseName(file);
	return name === "mod.rs" || RUST_ROOTS.includes(name)
		? dirOf(file)
		: under(dirOf(file), name.slice(0, -".rs".length));
}

function rustCrateRoot(path: string, view: GraphView): string | null {
	for (const dir of ancestors(dirOf(path))) {
		const root = firstIndexed(
			view,
			RUST_ROOTS.map((r) => under(dir, r)),
		);
		if (root !== null) return root;
	}
	return null;
}

function rustParent(file: string, view: GraphView): string | null {
	const name = baseName(file);
	if (RUST_ROOTS.includes(name)) return null;
	const dir = name === "mod.rs" ? dirOf(dirOf(file)) : dirOf(file);
	return firstIndexed(view, [
		under(dir, "mod.rs"),
		...RUST_ROOTS.map((r) => under(dir, r)),
		...(dir === "" ? [] : [`${dir}.rs`]),
	]);
}

function rustSubmodule(
	file: string,
	name: string,
	view: GraphView,
): string | null {
	const dir = rustChildDir(file);
	return firstIndexed(view, [
		under(dir, `${name}.rs`),
		under(dir, `${name}/mod.rs`),
	]);
}

/** The module file a `use` path reaches, and the segments left over as item names. */
function rustModule(
	path: string,
	segments: readonly string[],
	view: GraphView,
): Readonly<{ file: string; rest: readonly string[] }> | null {
	const [first, ...tail] = segments;
	let file: string | null;
	if (first === "crate") file = rustCrateRoot(path, view);
	else if (first === "self") file = path;
	else if (first === "super") file = rustParent(path, view);
	else return null;
	for (let i = 0; i < tail.length; i++) {
		if (file === null) return null;
		const segment = tail[i] ?? "";
		const next =
			segment === "super"
				? rustParent(file, view)
				: rustSubmodule(file, segment, view);
		if (next === null) {
			return segment === "super" ? null : { file, rest: tail.slice(i) };
		}
		file = next;
	}
	return file === null ? null : { file, rest: [] };
}

function rustImport(
	path: string,
	imp: ParsedImport,
	view: GraphView,
): ImportResolution {
	const found = rustModule(path, imp.source.split("::"), view);
	if (found === null) return NONE;
	const files = [found.file];
	const owner = found.rest.at(-1) ?? null;
	const bindings = imp.names.flatMap((b): Binding[] => {
		if (b.name === "*") return owner === null ? [{ kind: "glob", files }] : [];
		if (b.name === "self") {
			const local = b.alias ?? lastSegment(imp.source, "::");
			return owner === null
				? [{ kind: "namespace", local, files }]
				: [
						{
							kind: "named",
							local,
							files,
							name: owner,
							parent: found.rest.at(-2) ?? null,
						},
					];
		}
		const local = b.alias ?? b.name;
		if (owner === null) {
			const sub = rustSubmodule(found.file, b.name, view);
			if (sub !== null) return [{ kind: "namespace", local, files: [sub] }];
		}
		return [{ kind: "named", local, files, name: b.name, parent: owner }];
	});
	return {
		files: unique([...files, ...bindings.flatMap((b) => b.files)]),
		bindings,
	};
}

/** Resolves one import of the file at `path`. */
export function resolveImport(
	path: string,
	lang: Lang,
	imp: ParsedImport,
	view: GraphView,
): ImportResolution {
	switch (lang) {
		case "typescript":
		case "tsx":
		case "javascript":
			return jsImport(path, imp, view);
		case "python":
			return pyImport(path, imp, view);
		case "go":
			return goImport(imp, view);
		case "java":
			return javaImport(imp, view);
		case "rust":
			return rustImport(path, imp, view);
		default: {
			const unreachable: never = lang;
			return unreachable;
		}
	}
}
