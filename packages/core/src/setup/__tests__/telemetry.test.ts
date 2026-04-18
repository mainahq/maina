/**
 * Tests for `packages/core/src/setup/telemetry.ts`.
 *
 * Coverage:
 *   - Opt-out precedence: flag > env > config > default(opted in)
 *   - `anonymizeStack` strips non-enum fields (subprojects, buildTool, cicd)
 *   - `sendSetupTelemetry` never throws: success, timeout, 5xx, network err
 *   - Payload contains zero PII keys (no cwd, no paths, no repoUrl, etc.)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StackContext } from "../context";
import {
	anonymizeStack,
	isTelemetryOptedOut,
	newSetupId,
	type SetupTelemetryEvent,
	sendSetupTelemetry,
} from "../telemetry";

// ── Fixtures ────────────────────────────────────────────────────────────────

function fakeStack(overrides?: Partial<StackContext>): StackContext {
	return {
		languages: ["typescript"],
		frameworks: ["next.js"],
		packageManager: "bun",
		buildTool: "bunup",
		linters: ["biome"],
		testRunners: ["bun:test"],
		cicd: ["github-actions"],
		repoSize: { files: 42, bytes: 12345 },
		isEmpty: false,
		isLarge: false,
		...overrides,
	};
}

function fakeEvent(
	overrides?: Partial<SetupTelemetryEvent>,
): SetupTelemetryEvent {
	return {
		setupId: "abc123def456abc123def456abc12345",
		stack: anonymizeStack(fakeStack()),
		durationMs: 1234,
		phases: [
			{ phase: "preflight", status: "ok", durationMs: 2 },
			{ phase: "detect", status: "ok", durationMs: 180 },
		],
		aiSource: "byok",
		tailored: true,
		degraded: false,
		mainaVersion: "0.6.0",
		mode: "fresh",
		ci: false,
		...overrides,
	};
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`maina-telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── Opt-out resolution ─────────────────────────────────────────────────────

describe("isTelemetryOptedOut — precedence", () => {
	test("default: no flag / no env / no config → opted in", () => {
		expect(isTelemetryOptedOut({ env: {} })).toEqual({
			optedOut: false,
			reason: null,
		});
	});

	test("--no-telemetry flag → opted out, reason=flag", () => {
		expect(isTelemetryOptedOut({ flag: false, env: {} })).toEqual({
			optedOut: true,
			reason: "flag",
		});
	});

	test("flag:true (default/not-passed) is treated as opted-in if no other signal", () => {
		expect(isTelemetryOptedOut({ flag: true, env: {} })).toEqual({
			optedOut: false,
			reason: null,
		});
	});

	test("MAINA_TELEMETRY=0 → opted out, reason=env", () => {
		expect(
			isTelemetryOptedOut({
				env: { MAINA_TELEMETRY: "0" } as NodeJS.ProcessEnv,
			}),
		).toEqual({ optedOut: true, reason: "env" });
	});

	test("MAINA_TELEMETRY=false|no|off → opted out", () => {
		for (const v of ["false", "FALSE", "no", "NO", "off"]) {
			expect(
				isTelemetryOptedOut({
					env: { MAINA_TELEMETRY: v } as NodeJS.ProcessEnv,
				}),
			).toEqual({ optedOut: true, reason: "env" });
		}
	});

	test("MAINA_TELEMETRY=1|true|yes|on → opted in", () => {
		for (const v of ["1", "true", "yes", "on"]) {
			expect(
				isTelemetryOptedOut({
					env: { MAINA_TELEMETRY: v } as NodeJS.ProcessEnv,
				}),
			).toEqual({ optedOut: false, reason: null });
		}
	});

	test(".maina/config.json: { telemetry: false } → opted out, reason=config", () => {
		const cfgDir = join(tmpDir, ".maina");
		mkdirSync(cfgDir, { recursive: true });
		const cfgPath = join(cfgDir, "config.json");
		writeFileSync(cfgPath, JSON.stringify({ telemetry: false }));
		expect(isTelemetryOptedOut({ env: {}, configPath: cfgPath })).toEqual({
			optedOut: true,
			reason: "config",
		});
	});

	test("config file missing → opted in (default)", () => {
		const cfgPath = join(tmpDir, ".maina", "config.json");
		expect(isTelemetryOptedOut({ env: {}, configPath: cfgPath })).toEqual({
			optedOut: false,
			reason: null,
		});
	});

	test("config file malformed JSON → opted in (silent)", () => {
		const cfgDir = join(tmpDir, ".maina");
		mkdirSync(cfgDir, { recursive: true });
		const cfgPath = join(cfgDir, "config.json");
		writeFileSync(cfgPath, "{not json");
		expect(isTelemetryOptedOut({ env: {}, configPath: cfgPath })).toEqual({
			optedOut: false,
			reason: null,
		});
	});

	test("flag beats env beats config", () => {
		const cfgDir = join(tmpDir, ".maina");
		mkdirSync(cfgDir, { recursive: true });
		const cfgPath = join(cfgDir, "config.json");
		writeFileSync(cfgPath, JSON.stringify({ telemetry: false }));

		// Flag=false (opt-out) with env opted-in → flag wins.
		expect(
			isTelemetryOptedOut({
				flag: false,
				env: { MAINA_TELEMETRY: "1" } as NodeJS.ProcessEnv,
				configPath: cfgPath,
			}),
		).toEqual({ optedOut: true, reason: "flag" });

		// No flag, env opted-in, config opted-out → env wins.
		expect(
			isTelemetryOptedOut({
				env: { MAINA_TELEMETRY: "1" } as NodeJS.ProcessEnv,
				configPath: cfgPath,
			}),
		).toEqual({ optedOut: false, reason: null });

		// No flag, no env, config opted-out → config wins.
		expect(
			isTelemetryOptedOut({
				env: {},
				configPath: cfgPath,
			}),
		).toEqual({ optedOut: true, reason: "config" });
	});
});

// ── Anonymization ───────────────────────────────────────────────────────────

describe("anonymizeStack", () => {
	test("returns only the enumerated telemetry stack fields", () => {
		const ctx = fakeStack({
			subprojects: [fakeStack({ languages: ["python"] })],
		});
		const out = anonymizeStack(ctx);
		const keys = Object.keys(out).sort();
		expect(keys).toEqual(
			[
				"frameworks",
				"isEmpty",
				"isLarge",
				"languages",
				"linters",
				"packageManager",
				"repoSize",
				"testRunners",
			].sort(),
		);
		// `subprojects`, `buildTool`, `cicd` must be dropped.
		const record = out as unknown as Record<string, unknown>;
		expect(record.subprojects).toBeUndefined();
		expect(record.buildTool).toBeUndefined();
		expect(record.cicd).toBeUndefined();
	});

	test("sorts array fields for deterministic output", () => {
		const ctx = fakeStack({
			languages: ["typescript", "python"],
			frameworks: ["next.js", "django"],
			linters: ["eslint", "biome"],
			testRunners: ["vitest", "bun:test"],
		});
		const out = anonymizeStack(ctx);
		expect(out.languages).toEqual(["python", "typescript"]);
		expect(out.frameworks).toEqual(["django", "next.js"]);
		expect(out.linters).toEqual(["biome", "eslint"]);
		expect(out.testRunners).toEqual(["bun:test", "vitest"]);
	});
});

// ── Setup ID ────────────────────────────────────────────────────────────────

describe("newSetupId", () => {
	test("returns 32 hex chars", () => {
		const id = newSetupId("fp123");
		expect(id).toMatch(/^[0-9a-f]{32}$/);
	});

	test("two calls with same fingerprint return different ids (random salt)", () => {
		const a = newSetupId("fp123");
		const b = newSetupId("fp123");
		expect(a).not.toEqual(b);
	});
});

// ── sendSetupTelemetry ──────────────────────────────────────────────────────

describe("sendSetupTelemetry — network behaviour", () => {
	test("200 response → { sent: true, error: null }", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = (async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;

		const out = await sendSetupTelemetry({
			cwd: "/tmp",
			event: fakeEvent(),
			fetchImpl,
			userAgent: "maina/test",
		});

		expect(out).toEqual({ sent: true, error: null });
		expect(calls.length).toBe(1);
		expect(calls[0]?.url).toBe("https://api.mainahq.com/v1/setup/telemetry");
		// Headers include UA + JSON content-type
		const headers = calls[0]?.init?.headers as Record<string, string>;
		expect(headers["User-Agent"]).toBe("maina/test");
		expect(headers["Content-Type"]).toBe("application/json");
	});

	test("5xx response → { sent: false, error: 'http_503' }, no throw", async () => {
		const fetchImpl = (async () =>
			new Response("fail", { status: 503 })) as unknown as typeof fetch;
		const out = await sendSetupTelemetry({
			cwd: "/tmp",
			event: fakeEvent(),
			fetchImpl,
			userAgent: "maina/test",
		});
		expect(out.sent).toBe(false);
		expect(out.error).toBe("http_503");
	});

	test("4xx response → { sent: false, error: 'http_400' }, no throw", async () => {
		const fetchImpl = (async () =>
			new Response("bad", { status: 400 })) as unknown as typeof fetch;
		const out = await sendSetupTelemetry({
			cwd: "/tmp",
			event: fakeEvent(),
			fetchImpl,
			userAgent: "maina/test",
		});
		expect(out.sent).toBe(false);
		expect(out.error).toBe("http_400");
	});

	test("timeout → { sent: false, error: 'timeout' }", async () => {
		// fetch that hangs until the AbortSignal fires.
		const fetchImpl = ((_: string, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				const sig = init?.signal as AbortSignal | undefined;
				if (sig) {
					sig.addEventListener("abort", () => {
						const err = new Error("aborted");
						err.name = "AbortError";
						reject(err);
					});
				}
			});
		}) as unknown as typeof fetch;

		const out = await sendSetupTelemetry({
			cwd: "/tmp",
			event: fakeEvent(),
			fetchImpl,
			userAgent: "maina/test",
			timeoutMs: 20,
		});
		expect(out.sent).toBe(false);
		expect(out.error).toBe("timeout");
	});

	test("network error (fetch throws) → { sent: false }, no throw", async () => {
		const fetchImpl = (async () => {
			throw new Error("ECONNREFUSED: no cloud today");
		}) as unknown as typeof fetch;
		const out = await sendSetupTelemetry({
			cwd: "/tmp",
			event: fakeEvent(),
			fetchImpl,
			userAgent: "maina/test",
		});
		expect(out.sent).toBe(false);
		expect(out.error).toContain("ECONNREFUSED");
	});

	test("custom cloudUrl is honoured + trailing slash stripped", async () => {
		const calls: string[] = [];
		const fetchImpl = (async (url: string) => {
			calls.push(url);
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		await sendSetupTelemetry({
			cwd: "/tmp",
			event: fakeEvent(),
			fetchImpl,
			userAgent: "maina/test",
			cloudUrl: "https://staging.example.com/",
		});
		expect(calls[0]).toBe("https://staging.example.com/v1/setup/telemetry");
	});
});

describe("sendSetupTelemetry — payload is PII-free", () => {
	test("body contains only the enumerated keys, no PII", async () => {
		let capturedBody = "";
		const fetchImpl = (async (_: string, init?: RequestInit) => {
			capturedBody = (init?.body as string | undefined) ?? "";
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;

		await sendSetupTelemetry({
			cwd: "/Users/someone/secret-project",
			event: fakeEvent(),
			fetchImpl,
			userAgent: "maina/test",
		});

		const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
		const keys = Object.keys(parsed).sort();
		expect(keys).toEqual(
			[
				"aiSource",
				"ci",
				"degraded",
				"durationMs",
				"mainaVersion",
				"mode",
				"phases",
				"setupId",
				"stack",
				"tailored",
			].sort(),
		);

		// Defensive: ensure none of the forbidden PII keys leaked in.
		const forbidden = [
			"cwd",
			"path",
			"paths",
			"repoUrl",
			"repo_url",
			"user",
			"userName",
			"email",
			"sha",
			"commit",
			"branch",
			"stack_trace",
			"stackTrace",
			"error",
		];
		for (const f of forbidden) {
			expect(keys).not.toContain(f);
		}
		// The serialised body must not accidentally contain the cwd string.
		expect(capturedBody).not.toContain("secret-project");
	});
});
