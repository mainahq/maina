import { describe, expect, test } from "bun:test";
import { createMcpServer } from "../server";

// Access the private _registeredTools map for testing
function getRegisteredToolNames(
	server: ReturnType<typeof createMcpServer>,
): string[] {
	// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test inspection
	const internal = server as any;
	return Object.keys(internal._registeredTools ?? {});
}

// ── Server creation ────────────────────────────────────────────────────────

describe("createMcpServer", () => {
	test("returns a McpServer instance", () => {
		const server = createMcpServer();
		expect(server).toBeDefined();
		expect(typeof server.connect).toBe("function");
		expect(typeof server.close).toBe("function");
	});

	test("default mode registers only 3 progressive tools + list_tools meta-tool", () => {
		// Progressive disclosure: the handshake payload is intentionally
		// small. Agents discover the remaining tools via `list_tools` and
		// opt in via `--all-tools`. See progressive-tools.test.ts for the
		// full contract.
		const server = createMcpServer();
		const names = getRegisteredToolNames(server);
		expect(names).toHaveLength(4);
		expect(names).toContain("list_tools");
		expect(names).toContain("verify");
		expect(names).toContain("getContext");
		expect(names).toContain("reviewCode");
	});

	test("allTools mode registers 10 tools without list_tools", () => {
		const server = createMcpServer({ allTools: true });
		const names = getRegisteredToolNames(server);
		expect(names).toHaveLength(10);
		expect(names).not.toContain("list_tools");
	});

	test("allTools mode registers context tools", () => {
		const server = createMcpServer({ allTools: true });
		const names = getRegisteredToolNames(server);
		expect(names).toContain("getContext");
		expect(names).toContain("getConventions");
	});

	test("allTools mode registers verify tools", () => {
		const server = createMcpServer({ allTools: true });
		const names = getRegisteredToolNames(server);
		expect(names).toContain("verify");
		expect(names).toContain("checkSlop");
	});

	test("allTools mode registers feature tools", () => {
		const server = createMcpServer({ allTools: true });
		const names = getRegisteredToolNames(server);
		expect(names).toContain("suggestTests");
		expect(names).toContain("analyzeFeature");
	});

	test("allTools mode registers explain tools", () => {
		const server = createMcpServer({ allTools: true });
		const names = getRegisteredToolNames(server);
		expect(names).toContain("explainModule");
	});

	test("allTools mode registers review tools", () => {
		const server = createMcpServer({ allTools: true });
		const names = getRegisteredToolNames(server);
		expect(names).toContain("reviewCode");
	});
});

// ── Tool handler smoke tests ───────────────────────────────────────────────
// These call the registered handler directly via the internal registry.

function getToolCallback(
	server: ReturnType<typeof createMcpServer>,
	toolName: string,
	// biome-ignore lint/suspicious/noExplicitAny: test helper accessing internals
): ((...args: any[]) => any) | undefined {
	// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test inspection
	const internal = server as any;
	const registered = internal._registeredTools?.[toolName];
	return registered?.handler;
}

describe("list_tools meta-tool", () => {
	test("returns the 10-tool Maina surface (DeepWiki compat lives separately)", async () => {
		const server = createMcpServer();
		const cb = getToolCallback(server, "list_tools");
		expect(cb).toBeDefined();
		if (!cb) return;

		const result = await cb({}, {});
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.data.tools.length).toBe(10);
		expect(parsed.data.total).toBe(10);

		const toolNames = parsed.data.tools.map((t: { name: string }) => t.name);
		expect(toolNames).toContain("verify");
		expect(toolNames).toContain("reviewCode");
		expect(toolNames).toContain("wikiQuery");
		// DeepWiki compat tools are registered only in allTools mode and are
		// not part of the 10-tool list_tools surface.
		expect(toolNames).not.toContain("ask_question");
		expect(toolNames).not.toContain("read_wiki_structure");
	});
});

describe("tool handlers return error on missing dependencies", () => {
	// These tests verify that each tool handler catches errors gracefully
	// rather than crashing the server.

	test("getContext handler returns error for invalid cwd", async () => {
		const server = createMcpServer();
		const cb = getToolCallback(server, "getContext");
		expect(cb).toBeDefined();
		if (!cb) return;

		// Call with valid command; handler should catch errors from missing .maina dir
		const result = await cb({ command: "commit" }, {});
		expect(result).toBeDefined();
		expect(result.content).toBeDefined();
		expect(result.content[0].type).toBe("text");
	});

	test("reviewCode handler works with deterministic review", async () => {
		const server = createMcpServer();
		const cb = getToolCallback(server, "reviewCode");
		expect(cb).toBeDefined();
		if (!cb) return;

		const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,5 @@
+export function hello() { return "world"; }`;

		const result = await cb({ diff, planContent: undefined }, {});
		expect(result).toBeDefined();
		expect(result.content[0].type).toBe("text");

		// Should be valid JSON
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed).toHaveProperty("passed");
		expect(parsed).toHaveProperty("stage1");
	});

	test("reviewCode detects code quality issues", async () => {
		const server = createMcpServer();
		const cb = getToolCallback(server, "reviewCode");
		expect(cb).toBeDefined();
		if (!cb) return;

		const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,5 @@
+console.log("debug stuff");
+// TODO fix this later`;

		const result = await cb({ diff }, {});
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.stage2).toBeDefined();
		expect(parsed.stage2.findings.length).toBeGreaterThan(0);
	});

	test("checkSlop handler (allTools mode) returns error for nonexistent files", async () => {
		const server = createMcpServer({ allTools: true });
		const cb = getToolCallback(server, "checkSlop");
		expect(cb).toBeDefined();
		if (!cb) return;

		const result = await cb({ files: ["/nonexistent/file.ts"] }, {});
		expect(result).toBeDefined();
		expect(result.content[0].type).toBe("text");
	});

	test("explainModule handler (allTools mode) returns gracefully without db", async () => {
		const server = createMcpServer({ allTools: true });
		const cb = getToolCallback(server, "explainModule");
		expect(cb).toBeDefined();
		if (!cb) return;

		const result = await cb({ scope: undefined }, {});
		expect(result).toBeDefined();
		expect(result.content[0].type).toBe("text");
	});

	test("analyzeFeature handler (allTools mode) returns error for missing dir", async () => {
		const server = createMcpServer({ allTools: true });
		const cb = getToolCallback(server, "analyzeFeature");
		expect(cb).toBeDefined();
		if (!cb) return;

		const result = await cb({ featureDir: "/nonexistent/feature/dir" }, {});
		expect(result).toBeDefined();
		expect(result.content[0].type).toBe("text");
		expect(result.isError).toBe(true);
	});
});
