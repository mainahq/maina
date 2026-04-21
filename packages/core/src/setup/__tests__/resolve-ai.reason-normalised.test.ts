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
	cicd: [],
	repoSize: { files: 10, bytes: 1000 },
	isEmpty: false,
	isLarge: false,
};

const SUMMARY = "# Test repo\n";
const FP = "abcd1234abcd1234";

const ENV_KEYS = [
	"MAINA_HOST_MODE",
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CURSOR",
	"MAINA_API_KEY",
	"OPENROUTER_API_KEY",
	"ANTHROPIC_API_KEY",
];

let saved: Record<string, string | undefined>;

function clearEnv(): void {
	for (const k of ENV_KEYS) delete process.env[k];
}

function tmp(): string {
	const d = join(
		tmpdir(),
		`maina-reason-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(d, { recursive: true });
	return d;
}

beforeEach(() => {
	saved = {};
	for (const k of ENV_KEYS) saved[k] = process.env[k];
	clearEnv();
});

afterEach(() => {
	clearEnv();
	for (const k of ENV_KEYS) {
		const v = saved[k];
		if (v !== undefined) process.env[k] = v;
	}
});

const NORMALISED = new Set([
	"host_unavailable",
	"rate_limited",
	"byok_failed",
	"no_key",
	"ai_unavailable",
	"forced",
]);

describe("resolveSetupAI — normalised degraded reason", () => {
	test("cloud timeout maps to ai_unavailable with reasonDetail=timeout", async () => {
		const cwd = tmp();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: FP,
				cloudTimeoutMs: 1,
				fetchImpl: ((_u: string, init?: { signal?: AbortSignal }) => {
					return new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => {
							reject(
								new DOMException("aborted", "AbortError") as unknown as Error,
							);
						});
					});
				}) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(NORMALISED.has(result.metadata.reason ?? "")).toBe(true);
			expect(result.metadata.reasonDetail).toBe("timeout");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud http 500 maps to ai_unavailable with reasonDetail=http_500", async () => {
		const cwd = tmp();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: FP,
				fetchImpl: (async () =>
					new Response("", { status: 500 })) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.metadata.reason).toBe("ai_unavailable");
			expect(result.metadata.reasonDetail).toBe("http_500");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud 429 maps to rate_limited with retryAt", async () => {
		const cwd = tmp();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: FP,
				fetchImpl: (async () =>
					new Response(
						JSON.stringify({ meta: { retryAt: "2026-04-22T00:00:00Z" } }),
						{
							status: 429,
							headers: { "Content-Type": "application/json" },
						},
					)) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.metadata.reason).toBe("rate_limited");
			expect(result.metadata.retryAt).toBe("2026-04-22T00:00:00Z");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("byok attempted but returns null → byok_failed", async () => {
		const cwd = tmp();
		process.env.OPENROUTER_API_KEY = "sk-test";
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: FP,
				fetchImpl: (async () =>
					new Response("", { status: 500 })) as unknown as typeof fetch,
				byokGenerate: async () => "",
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.metadata.reason).toBe("byok_failed");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("host tier attempted and returns null → reason=host_unavailable", async () => {
		process.env.MAINA_HOST_MODE = "true";
		const cwd = tmp();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: FP,
				hostGenerate: async () => ({
					text: null,
					fromAI: false,
					hostDelegation: false,
				}),
				fetchImpl: (async () =>
					new Response("", { status: 500 })) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.metadata.reason).toBe("host_unavailable");
			expect(result.metadata.reasonDetail ?? "").toContain(
				"host_returned_null",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("host fails but cloud 429 wins (retry info > host signal)", async () => {
		process.env.MAINA_HOST_MODE = "true";
		const cwd = tmp();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: FP,
				hostGenerate: async () => ({
					text: null,
					fromAI: false,
					hostDelegation: false,
				}),
				fetchImpl: (async () =>
					new Response(
						JSON.stringify({ meta: { retryAt: "2026-04-22T00:00:00Z" } }),
						{ status: 429, headers: { "Content-Type": "application/json" } },
					)) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.metadata.reason).toBe("rate_limited");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("forceSource=degraded → reason=forced", async () => {
		const cwd = tmp();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: SUMMARY,
				fingerprint: FP,
				forceSource: "degraded",
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.metadata.reason).toBe("forced");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
