/**
 * Progressive MCP tool disclosure.
 *
 * The default handshake registers only 3 high-value tools (`verify`,
 * `getContext`, `reviewCode`) plus a `list_tools` meta-tool that advertises
 * the full surface. Passing `{ allTools: true }` opts out — all 10 are
 * registered at handshake and `list_tools` is not exposed.
 *
 * This keeps token usage low for the 95% of sessions that never need the
 * extended tools.
 */

import { describe, expect, test } from "bun:test";
import { createMcpServer } from "../server";

// Default / required tool contract — any change here needs a migration note
// in the parent onboarding-60s spec.
const DEFAULT_TOOLS = ["verify", "getContext", "reviewCode"] as const;

// The full ten-tool surface advertised by `list_tools`. See parent spec §6.7.
const ALL_TOOL_NAMES = [
	"verify",
	"getContext",
	"reviewCode",
	"checkSlop",
	"getConventions",
	"explainModule",
	"suggestTests",
	"analyzeFeature",
	"wikiQuery",
	"wikiStatus",
] as const;

function getRegisteredToolNames(
	server: ReturnType<typeof createMcpServer>,
): string[] {
	// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test inspection
	const internal = server as any;
	return Object.keys(internal._registeredTools ?? {});
}

function getToolCallback(
	server: ReturnType<typeof createMcpServer>,
	toolName: string,
	// biome-ignore lint/suspicious/noExplicitAny: test helper accessing internals
): ((...args: any[]) => any) | undefined {
	// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test inspection
	const internal = server as any;
	return internal._registeredTools?.[toolName]?.handler;
}

describe("progressive MCP disclosure — default mode", () => {
	test("registers exactly the 3 default tools + list_tools meta (4 total)", () => {
		const server = createMcpServer();
		const names = getRegisteredToolNames(server);
		expect(names.sort()).toEqual([...DEFAULT_TOOLS, "list_tools"].sort());
	});

	test("each DEFAULT_TOOLS name is registered", () => {
		const server = createMcpServer();
		const names = new Set(getRegisteredToolNames(server));
		for (const name of DEFAULT_TOOLS) {
			expect(names.has(name)).toBe(true);
		}
	});

	test("extended tools are NOT registered at handshake", () => {
		const server = createMcpServer();
		const names = new Set(getRegisteredToolNames(server));
		const defaults = new Set<string>(DEFAULT_TOOLS);
		const extended = ALL_TOOL_NAMES.filter((n) => !defaults.has(n));
		for (const name of extended) {
			expect(names.has(name)).toBe(false);
		}
	});

	test("list_tools returns all 10 tool descriptions", async () => {
		const server = createMcpServer();
		const cb = getToolCallback(server, "list_tools");
		expect(cb).toBeDefined();
		if (!cb) return;

		const result = await cb({}, {});
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.data.tools.length).toBe(ALL_TOOL_NAMES.length);
		expect(parsed.data.total).toBe(ALL_TOOL_NAMES.length);

		const names = parsed.data.tools.map((t: { name: string }) => t.name);
		for (const expected of ALL_TOOL_NAMES) {
			expect(names).toContain(expected);
		}
	});
});

const DEEPWIKI_TOOL_NAMES = [
	"ask_question",
	"read_wiki_structure",
	"read_wiki_contents",
];

describe("progressive MCP disclosure — allTools opt-out", () => {
	test("allTools: true registers every canonical tool", () => {
		const server = createMcpServer({ allTools: true });
		const names = new Set(getRegisteredToolNames(server));
		for (const t of ALL_TOOL_NAMES) {
			expect(names.has(t)).toBe(true);
		}
	});

	test("allTools: true does NOT register list_tools", () => {
		const server = createMcpServer({ allTools: true });
		const names = new Set(getRegisteredToolNames(server));
		expect(names.has("list_tools")).toBe(false);
	});

	test("allTools: true keeps DeepWiki-compat tools registered by default", () => {
		const server = createMcpServer({ allTools: true });
		const names = new Set(getRegisteredToolNames(server));
		for (const t of DEEPWIKI_TOOL_NAMES) {
			expect(names.has(t)).toBe(true);
		}
	});

	test("MAINA_MCP_STRICT_TEN=1 prunes DeepWiki down to the canonical 10", () => {
		const original = process.env.MAINA_MCP_STRICT_TEN;
		process.env.MAINA_MCP_STRICT_TEN = "1";
		try {
			const server = createMcpServer({ allTools: true });
			const names = getRegisteredToolNames(server);
			expect(names.sort()).toEqual([...ALL_TOOL_NAMES].sort());
			expect(names.length).toBe(ALL_TOOL_NAMES.length);
		} finally {
			if (original === undefined) delete process.env.MAINA_MCP_STRICT_TEN;
			else process.env.MAINA_MCP_STRICT_TEN = original;
		}
	});
});
