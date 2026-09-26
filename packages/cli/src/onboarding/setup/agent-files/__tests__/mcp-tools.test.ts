/**
 * Agent files name the MCP tools the server registers (#465): the list is
 * rendered from the MCP catalog, never hand-typed, so no agent file tells
 * a host to call a retired 1.x tool.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_TOOLS, findRetiredTools } from "@mainahq/mcp/catalog";
import { AGENT_FILES, type AgentKind } from "../index";
import type { StackContext } from "../types";

const STACK: StackContext = {
	languages: ["typescript"],
	frameworks: [],
	packageManager: "bun",
	buildTool: null,
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: [],
	repoSize: { files: 10, bytes: 1_000 },
	isEmpty: false,
	isLarge: false,
};

/** Agent files that carry an MCP tool list. */
const WITH_TOOL_LIST: readonly AgentKind[] = [
	"claude",
	"cursor",
	"copilot",
	"windsurf",
];

describe("agent files and MCP tools", () => {
	for (const file of AGENT_FILES) {
		test(`${file.path} names no retired MCP tool`, () => {
			const out = file.generate(STACK, "- TDD always");
			expect(findRetiredTools(out)).toEqual([]);
		});
	}

	for (const kind of WITH_TOOL_LIST) {
		test(`${kind} lists every default MCP tool`, () => {
			const file = AGENT_FILES.find((f) => f.kind === kind);
			expect(file).toBeDefined();
			const out = file?.generate(STACK, "- TDD always") ?? "";
			for (const tool of DEFAULT_TOOLS) {
				expect(out).toContain(`\`${tool}\``);
			}
		});
	}
});
