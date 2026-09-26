/**
 * Where tree-sitter comes from (mainahq/maina#526). By default the runtime
 * and grammars resolve inside the installed `@vscode/tree-sitter-wasm`
 * package; a compiled executable has no package to resolve, so it hands in
 * the copies embedded in it through `setTreeSitterSource`.
 *
 * The runtime initialises once per process. The isolated runner gives this
 * file its own process; when a plain `bun test` has already loaded the
 * runtime for another file, the source is refused and only the refusal is
 * checked. The source reads the package's own files, so any other test
 * that shares the process parses exactly as before.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
	loadGrammar,
	setTreeSitterSource,
	type TreeSitterRuntime,
	type TreeSitterSource,
} from "../tree-sitter";

const requireHere = createRequire(import.meta.url);
const bytesOf = (file: string): Uint8Array =>
	new Uint8Array(
		readFileSync(requireHere.resolve(`@vscode/tree-sitter-wasm/wasm/${file}`)),
	);

const asked: string[] = [];
const source: TreeSitterSource = {
	runtime: async () => {
		asked.push("runtime");
		return requireHere("@vscode/tree-sitter-wasm") as TreeSitterRuntime;
	},
	runtimeWasm: async () => {
		asked.push("tree-sitter.wasm");
		return bytesOf("tree-sitter.wasm");
	},
	grammar: async (file) => {
		asked.push(file);
		if (file === "tree-sitter-cobol.wasm") return null;
		if (file === "broken.wasm") throw new Error("disk on fire");
		return bytesOf(file);
	},
};

// Before any test runs, as a compiled executable does at start-up.
const accepted = setTreeSitterSource(source);

describe("setTreeSitterSource", () => {
	test.if(accepted.ok)(
		"loads the runtime and a grammar from the source's bytes",
		async () => {
			const bash = await loadGrammar("tree-sitter-bash.wasm");
			expect(bash.ok).toBe(true);
			if (!bash.ok) return;
			expect(asked).toEqual([
				"runtime",
				"tree-sitter.wasm",
				"tree-sitter-bash.wasm",
			]);
			const parser = new bash.value.runtime.Parser();
			parser.setLanguage(bash.value.language);
			expect(parser.parse("echo hi")?.rootNode.type).toBe("program");
			parser.delete();
		},
	);

	test.if(accepted.ok)(
		"a grammar the source does not have is an error value",
		async () => {
			expect(await loadGrammar("tree-sitter-cobol.wasm")).toEqual({
				ok: false,
				error: "tree-sitter-cobol.wasm is not available",
			});
		},
	);

	test.if(accepted.ok)(
		"a source that fails is an error value, not a throw",
		async () => {
			expect(await loadGrammar("broken.wasm")).toEqual({
				ok: false,
				error: "disk on fire",
			});
		},
	);

	test("is refused once the runtime has loaded", async () => {
		expect((await loadGrammar("tree-sitter-bash.wasm")).ok).toBe(true);
		expect(setTreeSitterSource(source)).toEqual({
			ok: false,
			error: { kind: "already_loaded" },
		});
	});
});
