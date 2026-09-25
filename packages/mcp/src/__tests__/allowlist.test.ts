/**
 * The tool allow-list (FR-MCP-2): at most 8 tools by default, narrowed or
 * extended (DeepWiki) through a `--tools` flag or the `MAINA_MCP_TOOLS`
 * env var, and applied with supported SDK APIs only (tools outside the
 * list are never registered, so nothing is pruned from private fields).
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
	ALL_TOOLS,
	DEEPWIKI_TOOLS,
	DEFAULT_TOOLS,
	readToolsFlag,
	resolveAllowList,
	TOOLS_ENV,
} from "../allowlist";
import { connect, fakeRuntime } from "./fixtures";

const V2_TOOLS = [
	"verify",
	"decide",
	"impact",
	"context",
	"review_triage",
	"spec_check",
	"receipt",
	"status",
];

async function listedNames(tools?: readonly string[]): Promise<string[]> {
	const client = await connect(fakeRuntime().runtime, { tools });
	const { tools: listed } = await client.listTools();
	return listed.map((t) => t.name);
}

describe("default tool set", () => {
	test("has at most 8 tools: the v2 set", () => {
		expect(DEFAULT_TOOLS.length).toBeLessThanOrEqual(8);
		expect<readonly string[]>([...DEFAULT_TOOLS]).toEqual(V2_TOOLS);
	});

	test("a default server lists exactly the v2 tools: no list_tools, no DeepWiki", async () => {
		const names = await listedNames();
		expect(names.length).toBeLessThanOrEqual(8);
		expect(names).toEqual(V2_TOOLS);
		expect(names).not.toContain("list_tools");
		for (const t of DEEPWIKI_TOOLS) expect(names).not.toContain(t);
	});
});

describe("createMcpServer({ tools })", () => {
	test("registers only the allow-listed tools", async () => {
		expect(await listedNames(["status", "verify"])).toEqual([
			"verify",
			"status",
		]);
	});

	test("DeepWiki tools are reachable only through the allow-list", async () => {
		const names = await listedNames(["ask_question", "read_wiki_contents"]);
		expect(names).toEqual(["ask_question", "read_wiki_contents"]);
	});

	test("every catalog tool can be enabled", async () => {
		expect(await listedNames([...ALL_TOOLS])).toEqual([...ALL_TOOLS]);
	});

	test("unknown names are ignored", async () => {
		expect(await listedNames(["verify", "list_tools", "nope"])).toEqual([
			"verify",
		]);
	});

	test("a tool outside the allow-list cannot be called", async () => {
		const client = await connect(fakeRuntime().runtime, { tools: ["status"] });
		const result = await client.callTool({
			name: "verify",
			arguments: { root: "/repo", files: [] },
		});
		expect(result.isError).toBe(true);
	});
});

describe("resolveAllowList", () => {
	test("no flag and no env: the default set", () => {
		expect(resolveAllowList({})).toEqual({
			tools: DEFAULT_TOOLS,
			unknown: [],
			source: "default",
		});
	});

	test("the flag names the tools", () => {
		expect(resolveAllowList({ flag: "verify, context" })).toEqual({
			tools: ["verify", "context"],
			unknown: [],
			source: "flag",
		});
	});

	test("the env var names the tools", () => {
		expect(resolveAllowList({ env: "status,ask_question" })).toEqual({
			tools: ["status", "ask_question"],
			unknown: [],
			source: "env",
		});
	});

	test("the flag wins over the env var", () => {
		expect(resolveAllowList({ flag: "verify", env: "status" }).tools).toEqual([
			"verify",
		]);
	});

	test("`default` expands to the default set, so DeepWiki can be added to it", () => {
		expect(resolveAllowList({ env: "default,ask_question" }).tools).toEqual([
			...DEFAULT_TOOLS,
			"ask_question",
		]);
	});

	test("unknown names are reported, duplicates dropped", () => {
		expect(resolveAllowList({ flag: "verify,verify,list_tools" })).toEqual({
			tools: ["verify"],
			unknown: ["list_tools"],
			source: "flag",
		});
	});

	test("a blank value falls through to the next source", () => {
		expect(resolveAllowList({ flag: " ", env: "status" }).source).toBe("env");
		expect(resolveAllowList({ env: "" }).source).toBe("default");
	});
});

describe("readToolsFlag", () => {
	test("reads `--tools a,b` and `--tools=a,b`", () => {
		expect(readToolsFlag(["bun", "maina", "--mcp", "--tools", "a,b"])).toBe(
			"a,b",
		);
		expect(readToolsFlag(["maina", "mcp", "--tools=verify"])).toBe("verify");
	});

	test("absent flag or missing value is undefined", () => {
		expect(readToolsFlag(["maina", "--mcp"])).toBeUndefined();
		expect(readToolsFlag(["maina", "--mcp", "--tools"])).toBeUndefined();
	});
});

// ── End to end over stdio: the flag and the env var reach the server ────────

const INDEX = join(import.meta.dir, "..", "index.ts");

async function stdioToolNames(
	args: readonly string[],
	env: Record<string, string>,
): Promise<string[]> {
	const proc = Bun.spawn(["bun", INDEX, ...args], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	const send = (msg: Record<string, unknown>) =>
		proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
	send({
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "allowlist-test", version: "0" },
		},
	});
	send({ method: "notifications/initialized" });
	send({ id: 2, method: "tools/list", params: {} });
	await proc.stdin.flush();

	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for await (const chunk of proc.stdout) {
			buffer += decoder.decode(chunk, { stream: true });
			for (const line of buffer.split("\n")) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line) as {
						id?: number;
						result?: { tools?: Array<{ name: string }> };
					};
					if (msg.id === 2) return (msg.result?.tools ?? []).map((t) => t.name);
				} catch {
					// partial line: keep reading
				}
			}
		}
		return [];
	} finally {
		proc.kill();
		await proc.exited;
	}
}

describe("startServer over stdio", () => {
	test("--tools narrows the handshake", async () => {
		expect(await stdioToolNames(["--tools", "status,verify"], {})).toEqual([
			"verify",
			"status",
		]);
	}, 20_000);

	test(`${TOOLS_ENV} narrows the handshake`, async () => {
		expect(
			await stdioToolNames([], { [TOOLS_ENV]: "status,read_wiki_structure" }),
		).toEqual(["status", "read_wiki_structure"]);
	}, 20_000);
});

// ── Static scan: supported SDK APIs only ────────────────────────────────────

const MCP_SRC = join(import.meta.dir, "..");
const REPO = join(MCP_SRC, "..", "..", "..");
const SELF = relative(MCP_SRC, import.meta.path);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return path.endsWith(".ts") ? [path] : [];
	});
}

/** Private SDK fields and the retired progressive-disclosure surface. */
const FORBIDDEN =
	/\b_registered(?:Tools|Resources|ResourceTemplates|Prompts)\b|\b_toolHandlersInitialized\b|\blist_tools\b|\ballTools\b|--all-tools|MAINA_MCP_STRICT_TEN/;

describe("static scan", () => {
	test("no private SDK fields or retired tool paths in the MCP package or its callers", () => {
		const files = [
			...sourceFiles(MCP_SRC).filter((f) => relative(MCP_SRC, f) !== SELF),
			join(REPO, "packages", "cli", "src", "index.ts"),
			join(REPO, "packages", "runtime", "src", "standalone", "main.ts"),
		];
		const offenders = files.flatMap((file) =>
			readFileSync(file, "utf-8")
				.split("\n")
				.flatMap((line, i) =>
					FORBIDDEN.test(line) ? [`${relative(REPO, file)}:${i + 1}`] : [],
				),
		);
		expect(offenders).toEqual([]);
	});
});
