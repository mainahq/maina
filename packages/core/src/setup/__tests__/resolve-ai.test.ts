import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StackContext } from "../context";
import { resolveSetupAI } from "../resolve-ai";

const STACK: StackContext = {
	languages: ["typescript"],
	frameworks: [],
	packageManager: "bun",
	buildTool: "bunup",
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: ["github-actions"],
	repoSize: { files: 100, bytes: 12345 },
	isEmpty: false,
	isLarge: false,
};

const SUMMARY = "# Repo Summary\n\nA tiny test repo.\n";

const ENV_KEYS = [
	"MAINA_HOST_MODE",
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CURSOR",
	"MAINA_API_KEY",
	"OPENROUTER_API_KEY",
	"ANTHROPIC_API_KEY",
];

let savedEnv: Record<string, string | undefined>;

function clearEnv(): void {
	for (const k of ENV_KEYS) {
		delete process.env[k];
	}
}

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-resolve-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	savedEnv = {};
	for (const k of ENV_KEYS) {
		savedEnv[k] = process.env[k];
	}
	clearEnv();
});

afterEach(() => {
	clearEnv();
	for (const k of ENV_KEYS) {
		const v = savedEnv[k];
		if (v !== undefined) process.env[k] = v;
	}
});

// ── Host mode ────────────────────────────────────────────────────────────────

describe("resolveSetupAI — host tier", () => {
	test("host mode returns source: 'host' with delegation", async () => {
		process.env.MAINA_HOST_MODE = "true";
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				hostGenerate: async (prompt) => ({
					text: null,
					fromAI: false,
					hostDelegation: true,
					promptHash: "hash-1",
					delegation: {
						task: "setup",
						systemPrompt: "sys",
						userPrompt: prompt,
						promptHash: "hash-1",
					},
				}),
			});
			expect(result.source).toBe("host");
			if (result.source !== "host") return;
			expect(result.text).toBeNull();
			expect(result.delegation.task).toBe("setup");
			expect(result.delegation.userPrompt.length).toBeGreaterThan(0);
			expect(result.metadata.attemptedSources).toEqual(["host"]);
			expect(result.metadata.promptHash).toBe("hash-1");
			expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("host returns null text → falls through to cloud", async () => {
		process.env.MAINA_HOST_MODE = "true";
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				hostGenerate: async () => ({
					text: null,
					fromAI: false,
					hostDelegation: false,
				}),
				fetchImpl: (async () =>
					new Response(
						JSON.stringify({
							data: {
								text: "## Constitution\n\nA fine starter.",
								usage: { promptTokens: 10, completionTokens: 20 },
							},
							error: null,
							meta: { source: "cloud" },
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					)) as unknown as typeof fetch,
			});
			expect(result.source).toBe("cloud");
			if (result.source !== "cloud") return;
			expect(result.text).toContain("Constitution");
			expect(result.metadata.attemptedSources).toEqual(["host", "cloud"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

// ── Cloud tier ───────────────────────────────────────────────────────────────

describe("resolveSetupAI — cloud tier", () => {
	test("cloud 200 returns source: 'cloud' with text + usage", async () => {
		const cwd = makeTmpDir();
		let capturedUrl = "";
		let capturedHeaders: Record<string, string> = {};
		let capturedBody: Record<string, unknown> = {};
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				userAgent: "maina/1.2.3",
				fetchImpl: (async (url: string, init?: RequestInit) => {
					capturedUrl = url;
					capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
					capturedBody = JSON.parse(init?.body as string);
					return new Response(
						JSON.stringify({
							data: {
								text: "## Constitution\n\nGenerated.",
								usage: { promptTokens: 5, completionTokens: 7 },
							},
							error: null,
							meta: { source: "cloud" },
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					);
				}) as unknown as typeof fetch,
			});
			expect(result.source).toBe("cloud");
			expect(capturedUrl.endsWith("/v1/setup")).toBe(true);
			expect(capturedHeaders["X-Maina-Fingerprint"]).toBe("abcd1234abcd1234");
			expect(capturedHeaders["User-Agent"]).toBe("maina/1.2.3");
			expect(capturedBody.stack).toBeDefined();
			expect(capturedBody.prompt).toBeDefined();
			expect(capturedBody.context).toBeDefined();
			if (result.source !== "cloud") return;
			expect(result.metadata.usage?.promptTokens).toBe(5);
			expect(result.metadata.usage?.completionTokens).toBe(7);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud 429 with retryAt → degraded retains retryAt", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				fetchImpl: (async () =>
					new Response(
						JSON.stringify({
							data: null,
							error: "rate_limited",
							meta: {
								retryAt: "2026-04-18T12:00:00Z",
								reason: "anonymous_quota",
								source: "cloud",
							},
						}),
						{
							status: 429,
							headers: { "Content-Type": "application/json" },
						},
					)) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.metadata.retryAt).toBe("2026-04-18T12:00:00Z");
			expect(result.metadata.reason).toBe("rate_limited");
			expect(result.text).toContain("Constitution");
			expect(result.metadata.attemptedSources).toEqual([
				"cloud",
				"byok",
				"degraded",
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud 502 → falls through to degraded", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				fetchImpl: (async () =>
					new Response(
						JSON.stringify({
							data: null,
							error: "gateway_unavailable",
							meta: { reason: "upstream_down", source: "cloud" },
						}),
						{
							status: 502,
							headers: { "Content-Type": "application/json" },
						},
					)) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud timeout (hangs > cloudTimeoutMs) → falls through fast", async () => {
		const cwd = makeTmpDir();
		const start = Date.now();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				cloudTimeoutMs: 100,
				fetchImpl: ((_: unknown, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal as AbortSignal | undefined;
						signal?.addEventListener("abort", () => {
							reject(new DOMException("aborted", "AbortError"));
						});
					})) as unknown as typeof fetch,
			});
			const elapsed = Date.now() - start;
			expect(result.source).toBe("degraded");
			expect(elapsed).toBeLessThan(2000);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud malformed JSON → falls through (treated as 5xx)", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				fetchImpl: (async () =>
					new Response("not-json-at-all{", {
						status: 200,
						headers: { "Content-Type": "application/json" },
					})) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud network error → falls through", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				fetchImpl: (async () => {
					throw new Error("ECONNREFUSED");
				}) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

// ── BYOK tier ────────────────────────────────────────────────────────────────

describe("resolveSetupAI — byok tier", () => {
	test("no host, no cloud, with API key → byok success", async () => {
		process.env.MAINA_API_KEY = "sk-test-key";
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				fetchImpl: (async () =>
					new Response("{}", { status: 500 })) as unknown as typeof fetch,
				// hostGenerate not provided — host tier skipped (not in host mode)
				byokGenerate: async () => "## Constitution\n\nFrom BYOK.",
			});
			expect(result.source).toBe("byok");
			if (result.source !== "byok") return;
			expect(result.text).toContain("BYOK");
			expect(result.metadata.attemptedSources).toEqual(["cloud", "byok"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("byok throws → falls through to degraded", async () => {
		process.env.MAINA_API_KEY = "sk-test-key";
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				fetchImpl: (async () =>
					new Response("{}", { status: 500 })) as unknown as typeof fetch,
				byokGenerate: async () => {
					throw new Error("AI provider down");
				},
			});
			expect(result.source).toBe("degraded");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

// ── Degraded tier ────────────────────────────────────────────────────────────

describe("resolveSetupAI — degraded tier", () => {
	test("no host, no cloud, no key → degraded with generic text", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				fetchImpl: (async () => {
					throw new Error("offline");
				}) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.text.length).toBeGreaterThan(50);
			// Should mention the detected language(s)
			expect(result.text.toLowerCase()).toContain("typescript");
			expect(result.metadata.reason).toBeDefined();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("forceSource: 'degraded' short-circuits all upstream tiers", async () => {
		process.env.MAINA_HOST_MODE = "true";
		process.env.MAINA_API_KEY = "sk-test";
		const cwd = makeTmpDir();
		let cloudCalled = false;
		let hostCalled = false;
		let byokCalled = false;
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: "abcd1234abcd1234",
				forceSource: "degraded",
				fetchImpl: (async () => {
					cloudCalled = true;
					return new Response("{}", { status: 200 });
				}) as unknown as typeof fetch,
				hostGenerate: async () => {
					hostCalled = true;
					return { text: null, fromAI: false, hostDelegation: false };
				},
				byokGenerate: async () => {
					byokCalled = true;
					return "x";
				},
			});
			expect(result.source).toBe("degraded");
			expect(cloudCalled).toBe(false);
			expect(hostCalled).toBe(false);
			expect(byokCalled).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
