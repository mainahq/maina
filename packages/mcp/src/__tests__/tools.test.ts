/**
 * The v2 tool set (FR-MCP-1, FR-MCP-4): every tool works from explicit
 * inputs, never the process working directory, and answers with structured
 * content (a `{ data, error, meta }` envelope) plus a text summary.
 */

import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "@mainahq/core";
import {
	type Call,
	call,
	connect,
	DEFAULT_ROOT,
	expectEnvelope,
	fakeRuntime,
	text,
} from "./fixtures";

const argsOf = (calls: readonly Call[], method: string): unknown =>
	calls.find((c) => c.method === method)?.args;

describe("verify", () => {
	test("passes explicit root and repo-relative files to the runtime", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "verify", {
			root: "/repo",
			files: ["src/a.ts", "/repo/src/b.ts", "./src/c.ts"],
			base: "origin/main",
		});
		expectEnvelope(result, "verify", "/repo");
		expect(argsOf(calls, "verify")).toEqual({
			root: "/repo",
			files: ["src/a.ts", "src/b.ts", "src/c.ts"],
			base: "origin/main",
		});
	});

	test("reports per-tool status and why each skipped tool was skipped (#421)", async () => {
		const { runtime } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "verify", {
			root: "/repo",
			files: ["src/a.ts"],
		});
		const data = result.structuredContent?.data as {
			passed: boolean;
			tools: Array<{
				tool: string;
				status: string;
				findings: number;
				reason?: string;
			}>;
			findings: unknown[];
			hiddenCount: number;
		};
		expect(data.passed).toBe(false);
		expect(data.hiddenCount).toBe(2);
		expect(data.findings).toHaveLength(1);
		const byTool = Object.fromEntries(data.tools.map((t) => [t.tool, t]));
		expect(byTool.slop).toMatchObject({ status: "passed", findings: 0 });
		expect(byTool.typecheck).toMatchObject({ status: "failed", findings: 1 });
		expect(byTool.semgrep?.status).toBe("skipped");
		expect(byTool.semgrep?.reason).toContain("not installed");
		expect(byTool.trivy?.status).toBe("skipped");
		expect(byTool.trivy?.reason).toBe(
			"trivy was detected but could not be started (EACCES)",
		);
		expect(byTool["ai-review"]?.status).toBe("skipped");
		expect(byTool["ai-review"]?.reason).toBeTruthy();
		expect(byTool.slop?.reason).toBeUndefined();

		// The text summary carries the skipped notices too.
		const summary = text(result);
		expect(summary).toContain("semgrep");
		expect(summary).toContain("could not be started");
	});

	test("an omitted root resolves through the runtime, not the process cwd", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "verify", { files: [] });
		expectEnvelope(result, "verify", DEFAULT_ROOT);
		expect(calls[0]).toEqual({ method: "resolveRoot", args: undefined });
		expect(argsOf(calls, "verify")).toEqual({ root: DEFAULT_ROOT, files: [] });
	});

	test("a file outside the root is refused before the runtime runs", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "verify", {
			root: "/repo",
			files: ["/elsewhere/x.ts"],
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.error?.kind).toBe("invalid_input");
		expect(result.structuredContent?.error?.message).toContain(
			"/elsewhere/x.ts",
		);
		expect(calls.some((c) => c.method === "verify")).toBe(false);
	});

	test("a base ref that looks like an option is refused before the runtime runs", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "verify", {
			root: "/repo",
			files: ["a.ts"],
			base: "--output=/tmp/pwned",
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.error?.kind).toBe("invalid_input");
		expect(calls.some((c) => c.method === "verify")).toBe(false);
	});

	test("an absolute file reached through a symlink of the root is inside it", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-mcp-link-")));
		try {
			const real = join(dir, "real");
			mkdirSync(join(real, "src"), { recursive: true });
			writeFileSync(join(real, "src", "a.ts"), "export {};\n");
			symlinkSync(real, join(dir, "link"));
			const { runtime, calls } = fakeRuntime();
			const client = await connect(runtime);
			const result = await call(client, "verify", {
				root: real,
				files: [join(dir, "link", "src", "a.ts")],
			});
			expectEnvelope(result, "verify", real);
			expect(argsOf(calls, "verify")).toEqual({
				root: real,
				files: ["src/a.ts"],
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a root that does not resolve is a structured error", async () => {
		const { runtime } = fakeRuntime({
			resolveRoot: async () => ({
				ok: false,
				error: { kind: "no_root", message: "no repository at /x" },
			}),
		});
		const client = await connect(runtime);
		const result = await call(client, "verify", { files: ["a.ts"] });
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.error?.message).toContain("no repository");
		expect(result.structuredContent?.data).toBeNull();
	});
});

describe("decide", () => {
	test("hands the typed request to the runtime and returns decisions", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "decide", {
			root: "/repo",
			type: "finding.real",
			questions: [{ kind: "bool", id: "q1" }],
			state: { trusted: { count: 1 }, untrusted: { line: "x" } },
		});
		expectEnvelope(result, "decide", "/repo");
		expect(argsOf(calls, "decide")).toEqual({
			root: "/repo",
			request: {
				type: "finding.real",
				questions: [{ kind: "bool", id: "q1" }],
				state: { trusted: { count: 1 }, untrusted: { line: "x" } },
			},
		});
		const data = result.structuredContent?.data as {
			decisions: Array<{ id: string; answer: unknown; confidence: number }>;
		};
		expect(data.decisions[0]).toMatchObject({
			id: "q1",
			answer: true,
			confidence: 0.8,
		});
	});

	test("state defaults to empty trusted and untrusted maps", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		await call(client, "decide", {
			root: "/repo",
			type: "finding.real",
			questions: [{ kind: "choice", id: "c", options: ["a", "b"] }],
		});
		expect(argsOf(calls, "decide")).toMatchObject({
			request: { state: { trusted: {}, untrusted: {} } },
		});
	});
});

describe("impact", () => {
	test("takes explicit files and symbols", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "impact", {
			root: "/repo",
			files: ["/repo/src/a.ts"],
			symbols: ["Circle.area"],
			depth: 2,
		});
		expectEnvelope(result, "impact", "/repo");
		expect(argsOf(calls, "impact")).toEqual({
			root: "/repo",
			files: ["src/a.ts"],
			symbols: ["Circle.area"],
			depth: 2,
		});
		const data = result.structuredContent?.data as {
			blastScore: number;
			dependents: string[];
		};
		expect(data.blastScore).toBe(0.25);
		expect(data.dependents).toEqual(["src/b.ts"]);
	});

	test("needs files or symbols", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "impact", { root: "/repo" });
		expect(result.isError).toBe(true);
		expect(calls.some((c) => c.method === "impact")).toBe(false);
	});
});

describe("context", () => {
	test("takes an explicit query and a token budget", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "context", {
			root: "/repo",
			query: "circle area",
			budgetTokens: 2000,
		});
		expectEnvelope(result, "context", "/repo");
		expect(argsOf(calls, "context")).toEqual({
			root: "/repo",
			query: "circle area",
			budgetTokens: 2000,
		});
		const data = result.structuredContent?.data as {
			snippets: Array<{ path: string; text: string }>;
			savedTokens: number;
		};
		expect(data.snippets[0]?.path).toBe("src/a.ts");
		expect(data.savedTokens).toBe(81);
	});

	test("defaults the budget and relativises files", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		await call(client, "context", { root: "/repo", files: ["/repo/src/a.ts"] });
		const args = argsOf(calls, "context") as {
			files: string[];
			budgetTokens: number;
		};
		expect(args.files).toEqual(["src/a.ts"]);
		expect(args.budgetTokens).toBeGreaterThan(0);
	});

	test("needs files or a query", async () => {
		const { runtime } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "context", { root: "/repo" });
		expect(result.isError).toBe(true);
	});
});

describe("review_triage", () => {
	test("buckets review findings into blocking, advisory and info", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "review_triage", {
			root: "/repo",
			diff: "diff --git a/src/a.ts b/src/a.ts\n",
		});
		expectEnvelope(result, "review_triage", "/repo");
		expect(argsOf(calls, "review")).toEqual({
			root: "/repo",
			diff: "diff --git a/src/a.ts b/src/a.ts\n",
		});
		const data = result.structuredContent?.data as {
			passed: boolean;
			counts: { blocking: number; advisory: number; info: number };
			blocking: Array<{ message: string }>;
		};
		expect(data.passed).toBe(false);
		expect(data.counts).toEqual({ blocking: 1, advisory: 1, info: 1 });
		expect(data.blocking[0]?.message).toBe("Empty catch block");
	});

	test("files narrow the triage to findings in those files", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "review_triage", {
			root: "/repo",
			files: ["src/b.ts"],
		});
		expect(argsOf(calls, "review")).toEqual({
			root: "/repo",
			files: ["src/b.ts"],
		});
		const data = result.structuredContent?.data as {
			counts: { blocking: number; advisory: number; info: number };
		};
		// Findings in other files drop out; findings with no file stay.
		expect(data.counts).toEqual({ blocking: 0, advisory: 1, info: 1 });
	});

	test("a blank diff counts as absent, so the files are diffed", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		await call(client, "review_triage", {
			root: "/repo",
			diff: "  \n",
			files: ["src/b.ts"],
		});
		expect(argsOf(calls, "review")).toEqual({
			root: "/repo",
			files: ["src/b.ts"],
		});
	});

	test("a base ref that looks like an option is refused before the runtime runs", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "review_triage", {
			root: "/repo",
			files: ["src/b.ts"],
			base: "--output=/tmp/pwned",
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.error?.kind).toBe("invalid_input");
		expect(calls.some((c) => c.method === "review")).toBe(false);
	});

	test("needs a diff or files", async () => {
		const { runtime } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "review_triage", { root: "/repo" });
		expect(result.isError).toBe(true);
	});
});

describe("spec_check", () => {
	test("checks each explicit feature path", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "spec_check", {
			root: "/repo",
			paths: ["/repo/.maina/features/001-a"],
		});
		expectEnvelope(result, "spec_check", "/repo");
		expect(argsOf(calls, "specCheck")).toEqual({
			root: "/repo",
			paths: [".maina/features/001-a"],
		});
		const data = result.structuredContent?.data as {
			passed: boolean;
			summary: { errors: number };
			reports: Array<{ path: string; findings: unknown[] }>;
		};
		expect(data.passed).toBe(false);
		expect(data.summary.errors).toBe(1);
		expect(data.reports[0]?.path).toBe(".maina/features/001-a");
	});
});

describe("receipt", () => {
	test("verifies each explicit receipt path", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "receipt", {
			root: "/repo",
			paths: ["r1.json", "r2.json"],
		});
		expectEnvelope(result, "receipt", "/repo");
		expect(argsOf(calls, "receipts")).toEqual({
			root: "/repo",
			paths: ["r1.json", "r2.json"],
		});
		const data = result.structuredContent?.data as {
			verified: number;
			failed: number;
			receipts: Array<{
				path: string;
				verified: boolean;
				passed?: number;
				total?: number;
				code?: string;
			}>;
		};
		expect(data.verified).toBe(1);
		expect(data.failed).toBe(1);
		expect(data.receipts[0]).toMatchObject({
			path: "r1.json",
			verified: true,
			passed: 2,
			total: 3,
		});
		expect(data.receipts[1]).toMatchObject({
			verified: false,
			code: "hash-mismatch",
		});
	});
});

describe("status", () => {
	test("reports version, root and the enabled tools", async () => {
		const { runtime } = fakeRuntime();
		const client = await connect(runtime, { tools: ["status", "verify"] });
		const result = await call(client, "status", { root: "/repo" });
		expectEnvelope(result, "status", "/repo");
		const data = result.structuredContent?.data as {
			version: string;
			tools: { enabled: string[] };
			wiki: { initialized: boolean };
		};
		expect(data.version).toBe(VERSION);
		expect(data.tools.enabled).toEqual(["verify", "status"]);
		expect(data.wiki.initialized).toBe(true);
	});
});

describe("DeepWiki-compatible tools (allow-listed)", () => {
	const tools = ["ask_question", "read_wiki_structure", "read_wiki_contents"];

	test("ask_question answers from the wiki at the explicit root", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime, { tools });
		const result = await call(client, "ask_question", {
			root: "/repo",
			question: "how does auth work?",
		});
		expectEnvelope(result, "ask_question", "/repo");
		expect(argsOf(calls, "wiki.ask")).toEqual({
			root: "/repo",
			question: "how does auth work?",
		});
	});

	test("read_wiki_structure and read_wiki_contents return structured data", async () => {
		const { runtime } = fakeRuntime();
		const client = await connect(runtime, { tools });
		const structure = await call(client, "read_wiki_structure", {
			root: "/repo",
		});
		expectEnvelope(structure, "read_wiki_structure", "/repo");
		const contents = await call(client, "read_wiki_contents", {
			root: "/repo",
			page: "modules/auth.md",
		});
		expectEnvelope(contents, "read_wiki_contents", "/repo");
		expect(contents.structuredContent?.data).toEqual({
			page: "modules/auth.md",
			content: "# Auth\n",
		});
	});

	test("read_wiki_contents refuses a page outside the wiki", async () => {
		const { runtime, calls } = fakeRuntime();
		const client = await connect(runtime, { tools });
		const result = await call(client, "read_wiki_contents", {
			root: "/repo",
			page: "../../etc/passwd",
		});
		expect(result.isError).toBe(true);
		expect(calls.some((c) => c.method === "wiki.contents")).toBe(false);
	});
});
