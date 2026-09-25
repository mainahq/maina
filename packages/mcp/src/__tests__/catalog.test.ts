/**
 * The agent-facing tool catalog (#465): one line of guidance per tool, the
 * retired 1.x names, and the one renderer every agent file, skill and doc
 * uses for its tool list, so none of them hand-types tool names.
 */

import { describe, expect, test } from "bun:test";
import { ALL_TOOLS, DEEPWIKI_TOOLS, DEFAULT_TOOLS } from "../allowlist";
import {
	findRetiredTools,
	RETIRED_TOOLS,
	renderToolList,
	TOOL_USAGE,
} from "../catalog";

describe("tool catalog", () => {
	test("every registrable tool has one line of guidance", () => {
		expect(Object.keys(TOOL_USAGE).sort()).toEqual([...ALL_TOOLS].sort());
		for (const tool of ALL_TOOLS) {
			const line = TOOL_USAGE[tool];
			expect(line.length).toBeGreaterThan(20);
			expect(line).not.toContain("\n");
			expect(line).not.toContain("|");
		}
	});

	test("the retired 1.x names are not registrable tools", () => {
		for (const name of [
			"getContext",
			"reviewCode",
			"checkSlop",
			"getConventions",
			"explainModule",
			"suggestTests",
			"analyzeFeature",
			"wikiQuery",
			"wikiStatus",
		]) {
			expect<readonly string[]>(RETIRED_TOOLS).toContain(name);
		}
		for (const name of RETIRED_TOOLS) {
			expect<readonly string[]>(ALL_TOOLS).not.toContain(name);
		}
	});
});

describe("renderToolList", () => {
	test("a list names each tool in catalog order with its guidance", () => {
		const out = renderToolList(DEFAULT_TOOLS, "list");
		const lines = out.split("\n");
		expect(lines).toHaveLength(DEFAULT_TOOLS.length);
		DEFAULT_TOOLS.forEach((tool, i) => {
			expect(lines[i]).toBe(`- \`${tool}\` — ${TOOL_USAGE[tool]}`);
		});
	});

	test("a table has a header row and one row per tool", () => {
		const out = renderToolList(DEEPWIKI_TOOLS, "table");
		const lines = out.split("\n");
		expect(lines[0]).toBe("| Tool | When to use |");
		expect(lines[1]).toBe("|------|-------------|");
		expect(lines.slice(2)).toEqual(
			DEEPWIKI_TOOLS.map((t) => `| \`${t}\` | ${TOOL_USAGE[t]} |`),
		);
	});

	test("never names a retired tool", () => {
		for (const format of ["list", "table"] as const) {
			expect(findRetiredTools(renderToolList(ALL_TOOLS, format))).toEqual([]);
		}
	});
});

describe("findRetiredTools", () => {
	test("finds each retired name once, as a whole word", () => {
		const text =
			"Call `getContext`, then `reviewCode`; call getContext again. wikiQueryX and mygetContext are not tool names.";
		expect(findRetiredTools(text)).toEqual(["getContext", "reviewCode"]);
	});

	test("ignores v1 tool names", () => {
		expect(
			findRetiredTools("Call `context`, `verify` and `review_triage`."),
		).toEqual([]);
	});
});
