/**
 * The tree-sitter runtime and grammars, embedded in the standalone
 * executable (mainahq/maina#526).
 *
 * `bun build --compile` bundles modules, not the files a module reads at run
 * time, so the compiled executable has no `@vscode/tree-sitter-wasm` for
 * core to load: the gate would see every shell command as opaque and the
 * code graph could not parse a file. Importing a `.wasm` file
 * `with { type: "file" }` makes bun embed it and gives its path (inside the
 * executable once compiled, in `node_modules` from source); the runtime
 * module itself is bundled by the static `import()` below.
 *
 * Only the grammars core loads are embedded: bash for the gate, and the
 * code-graph languages (`GRAPH_GRAMMAR_FILES`). About 7 MB in all: the
 * darwin-arm64 executable went from 62.2 MB to 69.4 MB.
 */

import { readFile } from "node:fs/promises";
import {
	type Result,
	setTreeSitterSource,
	type TreeSitterRuntime,
	type TreeSitterSource,
	type TreeSitterSourceError,
} from "@mainahq/core";
import runtimeWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm" with {
	type: "file",
};
import bash from "@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm" with {
	type: "file",
};
import go from "@vscode/tree-sitter-wasm/wasm/tree-sitter-go.wasm" with {
	type: "file",
};
import java from "@vscode/tree-sitter-wasm/wasm/tree-sitter-java.wasm" with {
	type: "file",
};
import javascript from "@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm" with {
	type: "file",
};
import python from "@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm" with {
	type: "file",
};
import rust from "@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm" with {
	type: "file",
};
import tsx from "@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm" with {
	type: "file",
};
import typescript from "@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm" with {
	type: "file",
};

/** Each embedded grammar's path, by the file name core asks for. */
export const EMBEDDED_GRAMMARS: Readonly<Record<string, string>> = {
	"tree-sitter-bash.wasm": bash,
	"tree-sitter-go.wasm": go,
	"tree-sitter-java.wasm": java,
	"tree-sitter-javascript.wasm": javascript,
	"tree-sitter-python.wasm": python,
	"tree-sitter-rust.wasm": rust,
	"tree-sitter-tsx.wasm": tsx,
	"tree-sitter-typescript.wasm": typescript,
};

const bytes = async (path: string): Promise<Uint8Array> =>
	new Uint8Array(await readFile(path));

export const embeddedTreeSitter: TreeSitterSource = {
	// A UMD bundle: bun exposes its `module.exports` as the default export.
	runtime: async () => {
		const loaded = (await import("@vscode/tree-sitter-wasm")) as
			| TreeSitterRuntime
			| { default: TreeSitterRuntime };
		return "default" in loaded ? loaded.default : loaded;
	},
	runtimeWasm: () => bytes(runtimeWasm),
	grammar: async (file) => {
		const path = Object.hasOwn(EMBEDDED_GRAMMARS, file)
			? EMBEDDED_GRAMMARS[file]
			: undefined;
		return path === undefined ? null : bytes(path);
	},
};

/** Makes core load tree-sitter from this executable. Call before anything parses. */
export function useEmbeddedTreeSitter(): Result<void, TreeSitterSourceError> {
	return setTreeSitterSource(embeddedTreeSitter);
}
