/**
 * One tree-sitter (WebAssembly) runtime per process, shared by every parser
 * in core: the code graph (ADR 0046) and the gate's shell parser (ADR 0047).
 *
 * The runtime is initialised once and each grammar is loaded once, on first
 * use. By default both come from the `@vscode/tree-sitter-wasm` package: a
 * grammar ships with the package like any other module code, so loading it
 * is not user-facing I/O and does not go through `CorePorts`. A compiled
 * executable has no package to resolve, so it hands in the copies embedded
 * in it with `setTreeSitterSource` before anything parses (#526). Loading
 * never throws: a broken install is an error value for the caller to map.
 */

import { createRequire } from "node:module";
import type * as TreeSitter from "@vscode/tree-sitter-wasm";
import type { Result } from "./db/index";

export type TreeSitterRuntime = typeof TreeSitter;
export type LoadedGrammar = Readonly<{
	runtime: TreeSitterRuntime;
	language: TreeSitter.Language;
}>;

/**
 * Where the runtime and the grammars come from. Each function may reject;
 * the loader turns that into an error value.
 */
export type TreeSitterSource = Readonly<{
	/** The runtime module: the package's exports. */
	runtime: () => Promise<TreeSitterRuntime>;
	/** The runtime's own WebAssembly, or null for the runtime to find it itself. */
	runtimeWasm: () => Promise<Uint8Array | null>;
	/** A grammar by file name, as bytes or a path; null when the source has none. */
	grammar: (file: string) => Promise<Uint8Array | string | null>;
}>;

export type TreeSitterSourceError = Readonly<{ kind: "already_loaded" }>;

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// The package is a UMD bundle whose named exports Node's ESM loader cannot
// see, so it is loaded with `require`, which behaves the same under Bun, Node
// and the bundled build. Loading it lazily means a broken install fails the
// parse with an error value instead of failing every import of core.
const requireHere = createRequire(import.meta.url);

/** The installed `@vscode/tree-sitter-wasm` package. */
const packageSource: TreeSitterSource = {
	runtime: async () =>
		requireHere("@vscode/tree-sitter-wasm") as TreeSitterRuntime,
	runtimeWasm: async () => null,
	grammar: async (file) =>
		requireHere.resolve(`@vscode/tree-sitter-wasm/wasm/${file}`),
};

let source: TreeSitterSource = packageSource;
let runtime: Promise<Result<TreeSitterRuntime, string>> | null = null;
const grammars = new Map<string, Promise<Result<LoadedGrammar, string>>>();

/**
 * Loads the runtime and grammars from `source` instead of the installed
 * package. Refused once loading has begun: parsers already made belong to
 * the runtime that is loaded, and there is one per process.
 */
export function setTreeSitterSource(
	next: TreeSitterSource,
): Result<void, TreeSitterSourceError> {
	if (runtime !== null) return { ok: false, error: { kind: "already_loaded" } };
	source = next;
	return { ok: true, value: undefined };
}

// The typings only name `locateFile`, but the runtime is an Emscripten
// module and takes its WebAssembly as `wasmBinary` too.
type InitOptions = Parameters<TreeSitterRuntime["Parser"]["init"]>[0];

function initRuntime(): Promise<Result<TreeSitterRuntime, string>> {
	runtime ??= (async (): Promise<Result<TreeSitterRuntime, string>> => {
		try {
			const loaded = await source.runtime();
			const wasmBinary = await source.runtimeWasm();
			await loaded.Parser.init(
				wasmBinary === null
					? undefined
					: ({ wasmBinary } as unknown as InitOptions),
			);
			return { ok: true, value: loaded };
		} catch (e) {
			return { ok: false, error: message(e) };
		}
	})();
	return runtime;
}

async function load(file: string): Promise<Result<LoadedGrammar, string>> {
	const ts = await initRuntime();
	if (!ts.ok) return ts;
	try {
		const input = await source.grammar(file);
		if (input === null) {
			return { ok: false, error: `${file} is not available` };
		}
		const language = await ts.value.Language.load(input);
		return { ok: true, value: { runtime: ts.value, language } };
	} catch (e) {
		return { ok: false, error: message(e) };
	}
}

/** Loads a grammar by its file name inside `@vscode/tree-sitter-wasm/wasm/`. */
export function loadGrammar(
	file: string,
): Promise<Result<LoadedGrammar, string>> {
	let loaded = grammars.get(file);
	if (loaded === undefined) {
		loaded = load(file);
		grammars.set(file, loaded);
	}
	return loaded;
}
