import { describe, expect, test } from "bun:test";
import { receiptSelection } from "../receipt";

// `maina receipt` reports staged diff stats, so its default verify scope
// must stay the index. Leaving `files` unset would fall through to the
// pipeline's working-tree default (#328) and check files the stats omit.
describe("receiptSelection", () => {
	test("defaults to the staged scope, never the working-tree default", () => {
		expect(receiptSelection({}, [])).toEqual({ scope: "staged" });
	});

	test("an empty pinned file list keeps the staged scope", () => {
		expect(receiptSelection({ files: [] }, [])).toEqual({ scope: "staged" });
	});

	test("a pinned file list wins over --all", () => {
		expect(receiptSelection({ files: ["a.ts"], all: true }, ["b.ts"])).toEqual({
			files: ["a.ts"],
		});
	});

	test("--all checks every tracked file", () => {
		expect(receiptSelection({ all: true }, ["a.ts", "b.ts"])).toEqual({
			files: ["a.ts", "b.ts"],
		});
	});
});
