/**
 * Test doubles for the MCP surface: a fake runtime that records every
 * capability call and answers with fixed data, and an in-memory client
 * connected through the SDK's public transport (no private fields).
 */

import { expect } from "bun:test";
import type { PipelineResult, Receipt } from "@mainahq/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpRuntime } from "../runtime";
import { createMcpServer } from "../server";

export const DEFAULT_ROOT = "/fake/default-root";

export type Call = Readonly<{ method: string; args: unknown }>;

const PIPELINE: PipelineResult = {
	status: "failed",
	passed: false,
	scope: { kind: "files", files: ["src/a.ts"] },
	syntaxPassed: true,
	tools: [
		{ tool: "slop", findings: [], skipped: false, duration: 4 },
		{ tool: "semgrep", findings: [], skipped: true, duration: 0 },
		{
			tool: "trivy",
			findings: [],
			skipped: true,
			duration: 1,
			notice: "trivy was detected but could not be started (EACCES)",
		},
		{
			tool: "typecheck",
			findings: [
				{
					tool: "typecheck",
					file: "src/a.ts",
					line: 3,
					message: "Type 'string' is not assignable to type 'number'.",
					severity: "error",
				},
			],
			skipped: false,
			duration: 120,
		},
		{ tool: "ai-review", findings: [], skipped: true, duration: 0 },
	],
	findings: [
		{
			tool: "typecheck",
			file: "src/a.ts",
			line: 3,
			column: 7,
			message: "Type 'string' is not assignable to type 'number'.",
			severity: "error",
			ruleId: "TS2322",
		},
	],
	hiddenCount: 2,
	detectedTools: [
		{ name: "semgrep", command: "semgrep", version: null, available: false },
		{ name: "trivy", command: "trivy", version: "0.50.0", available: true },
	],
	duration: 130,
	cacheHits: 0,
	cacheMisses: 1,
};

const RECEIPT = {
	status: "passed",
	hash: "sha256:abc",
	checks: [{ status: "passed" }, { status: "passed" }, { status: "failed" }],
} as unknown as Receipt;

/** A runtime whose capabilities record their input and return fixed data. */
export function fakeRuntime(overrides: Partial<McpRuntime> = {}): {
	runtime: McpRuntime;
	calls: Call[];
} {
	const calls: Call[] = [];
	const record = <T>(method: string, args: unknown, value: T) => {
		calls.push({ method, args });
		return Promise.resolve({ ok: true as const, value });
	};
	const runtime: McpRuntime = {
		version: "9.9.9-test",
		resolveRoot: (explicit) =>
			record("resolveRoot", explicit, explicit ?? DEFAULT_ROOT),
		verify: (call) => record("verify", call, PIPELINE),
		decide: (call) =>
			record("decide", call, [
				{
					id: "q1",
					type: call.request.type,
					answer: true,
					distribution: [
						{ answer: true, p: 0.8 },
						{ answer: false, p: 0.2 },
					],
					confidence: 0.8,
					backend: { id: "rules", version: "1" },
					latencyMs: 0,
				},
			]),
		impact: (call) =>
			record("impact", call, {
				targets: [
					{
						id: "src/a.ts#area",
						path: "src/a.ts",
						name: "area",
						qualifiedName: "area",
						kind: "function",
						startLine: 1,
						endLine: 4,
					},
				],
				unknown: ["src/missing.ts"],
				callers: [
					{
						id: "src/b.ts#draw",
						path: "src/b.ts",
						name: "draw",
						qualifiedName: "draw",
						kind: "function",
						startLine: 10,
						endLine: 20,
						depth: 1,
					},
				],
				dependents: ["src/b.ts"],
				tests: [],
				blastScore: 0.25,
			}),
		context: (call) =>
			record("context", call, {
				snippets: [
					{
						id: "src/a.ts#area",
						path: "src/a.ts",
						name: "area",
						qualifiedName: "area",
						kind: "function",
						startLine: 1,
						endLine: 2,
						reason: "target",
						depth: 0,
						text: "export function area() {\n}",
						tokens: 9,
					},
				],
				tokens: 9,
				naiveTokens: 90,
				savedTokens: 81,
				omitted: [],
				stale: [],
				unknown: [],
			}),
		review: (call) =>
			record("review", call, {
				delegated: false,
				result: {
					passed: false,
					stage1: { stage: "spec-compliance", passed: true, findings: [] },
					stage2: {
						stage: "code-quality",
						passed: false,
						findings: [
							{
								stage: "code-quality",
								severity: "error",
								message: "Empty catch block",
								file: "src/a.ts",
								line: 7,
							},
							{
								stage: "code-quality",
								severity: "warning",
								message: "console.log left in",
								file: "src/b.ts",
								line: 2,
							},
							{
								stage: "code-quality",
								severity: "info",
								message: "Consider a clearer name",
							},
						],
					},
				},
			}),
		specCheck: (call) =>
			record(
				"specCheck",
				call,
				call.paths.map((path) => ({
					path,
					report: {
						featureDir: `${call.root}/${path}`,
						findings: [
							{
								severity: "error" as const,
								category: "missing-file" as const,
								message: "tasks.md is missing",
								file: "tasks.md",
							},
						],
						summary: { errors: 1, warnings: 0, info: 0 },
					},
				})),
			),
		receipts: (call) =>
			record("receipts", call, [
				{ path: call.paths[0] ?? "", result: { ok: true, data: RECEIPT } },
				{
					path: call.paths[1] ?? "",
					result: {
						ok: false,
						code: "hash-mismatch",
						message: "Hash mismatch",
					},
				},
			]),
		status: (call) =>
			record("status", call, {
				graphIndexed: false,
				wikiInitialized: true,
				policyErrors: [],
			}),
		wiki: {
			ask: (call) =>
				record("wiki.ask", call, {
					answer: "Auth uses JWT.",
					sources: ["modules/auth.md"],
				}),
			structure: (call) =>
				record("wiki.structure", call, [
					{ path: "modules/auth.md", type: "module", title: "auth" },
				]),
			contents: (call) => record("wiki.contents", call, "# Auth\n"),
		},
		...overrides,
	};
	return { runtime, calls };
}

/** A client connected to a fresh server over the SDK's in-memory transport. */
export async function connect(
	runtime: McpRuntime,
	options: { tools?: readonly string[] } = {},
): Promise<Client> {
	const server = createMcpServer(runtime, options);
	const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	const client = new Client({ name: "maina-mcp-test", version: "0.0.0" });
	await client.connect(clientSide);
	return client;
}

type ToolResult = Readonly<{
	content: ReadonlyArray<{ type: string; text?: string }>;
	structuredContent?: {
		data: Record<string, unknown> | null;
		error: { kind: string; message: string } | null;
		meta: Record<string, unknown>;
	};
	isError?: boolean;
}>;

export async function call(
	client: Client,
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	return (await client.callTool({ name, arguments: args })) as ToolResult;
}

export function text(result: ToolResult): string {
	return result.content.map((c) => c.text ?? "").join("\n");
}

/** A successful call: a text summary and a `{ data, error: null, meta }` envelope. */
export function expectEnvelope(
	result: ToolResult,
	tool: string,
	root: string,
): void {
	expect(result.isError).toBeFalsy();
	expect(text(result).length).toBeGreaterThan(0);
	expect(result.structuredContent?.error).toBeNull();
	expect(result.structuredContent?.data).not.toBeNull();
	expect(result.structuredContent?.meta.tool).toBe(tool);
	expect(result.structuredContent?.meta.root).toBe(root);
}
