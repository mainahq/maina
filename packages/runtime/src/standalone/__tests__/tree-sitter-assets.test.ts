/**
 * The tree-sitter files the standalone executable embeds (mainahq/maina#526):
 * every grammar core loads, and nothing core never asks for.
 */

import { describe, expect, test } from "bun:test";
import { GRAPH_GRAMMAR_FILES, SHELL_GRAMMAR_FILE } from "@mainahq/core";
import { EMBEDDED_GRAMMARS, embeddedTreeSitter } from "../tree-sitter-assets";

const needed = [SHELL_GRAMMAR_FILE, ...Object.values(GRAPH_GRAMMAR_FILES)];

describe("embedded tree-sitter", () => {
	test("embeds exactly the grammars core loads", () => {
		expect(Object.keys(EMBEDDED_GRAMMARS).sort()).toEqual(
			[...new Set(needed)].sort(),
		);
	});

	test("hands out each grammar's WebAssembly", async () => {
		for (const file of needed) {
			const bytes = await embeddedTreeSitter.grammar(file);
			expect(bytes).toBeInstanceOf(Uint8Array);
			// Every WebAssembly module starts with "\0asm".
			expect([...(bytes as Uint8Array).subarray(0, 4)]).toEqual([
				0x00, 0x61, 0x73, 0x6d,
			]);
		}
	});

	test("has no grammar core never asks for", async () => {
		expect(await embeddedTreeSitter.grammar("tree-sitter-cobol.wasm")).toBe(
			null,
		);
	});

	test("hands out the runtime and its WebAssembly", async () => {
		const runtime = await embeddedTreeSitter.runtime();
		expect(typeof runtime.Parser.init).toBe("function");
		const wasm = await embeddedTreeSitter.runtimeWasm();
		expect([...(wasm ?? new Uint8Array()).subarray(0, 4)]).toEqual([
			0x00, 0x61, 0x73, 0x6d,
		]);
	});
});
