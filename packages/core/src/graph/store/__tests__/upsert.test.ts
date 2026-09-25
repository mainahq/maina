import { describe, expect, test } from "bun:test";
import { parseFile } from "../../parse/index";
import type { StoredFacts } from "../schema";
import { nodesOf } from "../upsert";
import { unwrap } from "./helpers";

async function factsOf(path: string, content: string): Promise<StoredFacts> {
	const {
		path: _p,
		lang: _l,
		isTestFile: _t,
		...facts
	} = unwrap(await parseFile(path, content));
	return { ...facts, lineCount: content.split("\n").length };
}

describe("nodesOf", () => {
	test("suffixes a repeated qualified name in source order and keeps ids line-independent", async () => {
		// Python lets a later `def` rebind a name; both definitions are kept.
		const source = [
			"def load():",
			"    return 1",
			"def load():",
			"    return 2",
			"",
		].join("\n");
		const before = nodesOf("a.py", false, await factsOf("a.py", source));
		const after = nodesOf(
			"a.py",
			false,
			await factsOf("a.py", `\n\n${source}`),
		);
		expect(before.map((n) => n.id)).toEqual([
			"a.py",
			"a.py#load",
			"a.py#load~2",
		]);
		expect(after.map((n) => n.id)).toEqual(before.map((n) => n.id));
		expect(after.map((n) => n.startLine)).not.toEqual(
			before.map((n) => n.startLine),
		);
	});

	test("adds test blocks that are not symbols, and flags symbols that are tests", async () => {
		const ts = nodesOf(
			"a.test.ts",
			true,
			await factsOf(
				"a.test.ts",
				'describe("greet", () => { it("formats", () => {}); });\n',
			),
		);
		expect(ts.map((n) => [n.id, n.kind, n.test])).toEqual([
			["a.test.ts", "file", true],
			["a.test.ts#greet", "suite", true],
			["a.test.ts#greet > formats", "test", true],
		]);

		const go = nodesOf(
			"a_test.go",
			true,
			await factsOf("a_test.go", "package a\n\nfunc TestArea(t *T) {}\n"),
		);
		expect(go.map((n) => [n.id, n.kind, n.test])).toEqual([
			["a_test.go", "file", true],
			["a_test.go#TestArea", "function", true],
		]);
	});
});
