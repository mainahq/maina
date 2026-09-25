/**
 * One tree-sitter (WebAssembly) runtime per process, shared by every parser
 * in core: the code graph (ADR 0046) and the gate's shell parser (ADR 0047).
 *
 * The runtime is initialised once and each grammar is loaded once, on first
 * use, from the `@vscode/tree-sitter-wasm` package. A grammar ships with the
 * package like any other module code, so loading it is not user-facing I/O
 * and does not go through `CorePorts`. Loading never throws: a broken install
 * is an error value for the caller to map.
 */

import { createRequire } from "node:module";
import type * as TreeSitter from "@vscode/tree-sitter-wasm";
import type { Result } from "./db/index";

export type TreeSitterRuntime = typeof TreeSitter;
export type LoadedGrammar = Readonly<{
	runtime: TreeSitterRuntime;
	language: TreeSitter.Language;
}>;

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// The package is a UMD bundle whose named exports Node's ESM loader cannot
// see, so it is loaded with `require`, which behaves the same under Bun, Node
// and the bundled build. Loading it lazily means a broken install fails the
// parse with an error value instead of failing every import of core.
const requireHere = createRequire(import.meta.url);

let runtime: Promise<Result<TreeSitterRuntime, string>> | null = null;
const grammars = new Map<string, Promise<Result<LoadedGrammar, string>>>();

function initRuntime(): Promise<Result<TreeSitterRuntime, string>> {
	runtime ??= (async (): Promise<Result<TreeSitterRuntime, string>> => {
		try {
			const loaded = requireHere(
				"@vscode/tree-sitter-wasm",
			) as TreeSitterRuntime;
			await loaded.Parser.init();
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
		const path = requireHere.resolve(`@vscode/tree-sitter-wasm/wasm/${file}`);
		const language = await ts.value.Language.load(path);
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
