import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildCliErrorPayload,
	isCliTelemetryOptedOut,
	sendCliErrorReport,
} from "../cli-error-reporter";

// ── Env hygiene ─────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;

function makeTempHome(): string {
	const dir = join(
		tmpdir(),
		`maina-cli-tel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(join(dir, ".maina"), { recursive: true });
	return dir;
}

beforeEach(() => {
	delete process.env.MAINA_TELEMETRY;
	delete process.env.DO_NOT_TRACK;
	delete process.env.CI;
	process.env.HOME = makeTempHome();
});

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	process.env = { ...ORIGINAL_ENV };
	globalThis.fetch = originalFetch;
});

// ── Payload shape ──────────────────────────────────────────────────────────

describe("buildCliErrorPayload", () => {
	test("produces payload matching server validator shape", () => {
		const err = new TypeError(
			"Cannot read properties of undefined (reading 'toLowerCase')",
		);
		const payload = buildCliErrorPayload(err, {
			mainaVersion: "1.5.1",
			command: "sync pull",
		});

		expect(payload.errorClass).toBe("TypeError");
		expect(payload.errorMessage).toContain("Cannot read properties");
		expect(payload.mainaVersion).toBe("1.5.1");
		expect(payload.command).toBe("sync pull");
		expect(payload.platform).toBe(process.platform);
		expect(payload.arch).toBe(process.arch);
		expect(payload.nodeVersion).toBe(process.version);
		expect(payload.ci).toBe(false);
		expect(payload.errorId).toMatch(/^[a-f0-9]{32}$/);
	});

	test("derives command from argv when not passed explicitly", () => {
		const payload = buildCliErrorPayload(new Error("boom"), {
			mainaVersion: "1.5.1",
			argv: ["bun", "/path/cli.js", "team", "info", "--verbose"],
		});

		expect(payload.command).toBe("team info");
	});

	test("ci flag reflects CI env var", () => {
		process.env.CI = "true";
		const payload = buildCliErrorPayload(new Error("x"), {
			mainaVersion: "1.5.1",
			command: "verify",
		});
		expect(payload.ci).toBe(true);
	});

	test("scrubs absolute /Users/... paths from message and stack", () => {
		const err = new Error("failed to read /Users/bikash/secret/file.ts");
		err.stack =
			"Error: boom\n    at parse (/Users/bikash/code/maina/packages/core/src/verify/typecheck.ts:42:10)";

		const payload = buildCliErrorPayload(err, {
			mainaVersion: "1.5.1",
			command: "verify",
		});

		expect(payload.errorMessage).not.toContain("/Users/bikash");
		expect(payload.errorStack).not.toContain("/Users/bikash");
	});

	test("scrubs /tmp/... paths down to basenames", () => {
		const err = new Error("read /tmp/weird/secret.txt failed");
		const payload = buildCliErrorPayload(err, {
			mainaVersion: "1.5.1",
			command: "verify",
		});
		expect(payload.errorMessage).not.toContain("/tmp/weird");
		expect(payload.errorMessage).toContain("secret.txt");
	});

	test("leaves fraction-looking tokens like 5/10 intact", () => {
		const err = new Error("retry 5/10 timed out");
		const payload = buildCliErrorPayload(err, {
			mainaVersion: "1.5.1",
			command: "verify",
		});
		expect(payload.errorMessage).toContain("5/10");
	});

	test("wraps non-Error throws", () => {
		const payload = buildCliErrorPayload("raw string boom", {
			mainaVersion: "1.5.1",
			command: "x",
		});
		expect(payload.errorClass).toBe("Error");
		expect(payload.errorMessage).toContain("raw string boom");
	});

	test("errorId is unique across calls (pid + hrtime + uuid)", () => {
		const a = buildCliErrorPayload(new Error("x"), {
			mainaVersion: "1.5.1",
			command: "y",
		});
		const b = buildCliErrorPayload(new Error("x"), {
			mainaVersion: "1.5.1",
			command: "y",
		});
		expect(a.errorId).not.toBe(b.errorId);
	});
});

// ── Opt-out ─────────────────────────────────────────────────────────────────

describe("isCliTelemetryOptedOut", () => {
	test("returns false by default", () => {
		expect(isCliTelemetryOptedOut()).toBe(false);
	});

	test("respects MAINA_TELEMETRY=0", () => {
		process.env.MAINA_TELEMETRY = "0";
		expect(isCliTelemetryOptedOut()).toBe(true);
	});

	test("respects DO_NOT_TRACK=1", () => {
		process.env.DO_NOT_TRACK = "1";
		expect(isCliTelemetryOptedOut()).toBe(true);
	});

	test("respects ~/.maina/telemetry.json { optOut: true }", () => {
		const home = process.env.HOME;
		if (!home) throw new Error("test HOME not set");
		writeFileSync(
			join(home, ".maina", "telemetry.json"),
			JSON.stringify({ optOut: true }),
			"utf-8",
		);
		expect(isCliTelemetryOptedOut()).toBe(true);
	});

	test("does not opt out for { optOut: false }", () => {
		const home = process.env.HOME;
		if (!home) throw new Error("test HOME not set");
		writeFileSync(
			join(home, ".maina", "telemetry.json"),
			JSON.stringify({ optOut: false }),
			"utf-8",
		);
		expect(isCliTelemetryOptedOut()).toBe(false);
	});

	test("handles malformed telemetry.json gracefully", () => {
		const home = process.env.HOME;
		if (!home) throw new Error("test HOME not set");
		writeFileSync(
			join(home, ".maina", "telemetry.json"),
			"{ not valid json",
			"utf-8",
		);
		expect(isCliTelemetryOptedOut()).toBe(false);
	});
});

// ── Transport ───────────────────────────────────────────────────────────────

describe("sendCliErrorReport", () => {
	test("POSTs payload to /v1/cli/errors", async () => {
		const seen: { url: string; body: unknown } = { url: "", body: null };
		const mockFetch = mock((url: string, init?: RequestInit) => {
			seen.url = url;
			seen.body = JSON.parse(String(init?.body ?? "null"));
			return Promise.resolve(new Response(null, { status: 202 }));
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await sendCliErrorReport(new Error("kaboom"), {
			mainaVersion: "1.5.1",
			command: "sync pull",
			baseUrl: "https://api.test.maina.dev",
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(seen.url).toBe("https://api.test.maina.dev/v1/cli/errors");
		expect((seen.body as { command: string }).command).toBe("sync pull");
	});

	test("skips POST when opted out", async () => {
		process.env.MAINA_TELEMETRY = "0";
		const mockFetch = mock(() =>
			Promise.resolve(new Response(null, { status: 202 })),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await sendCliErrorReport(new Error("x"), {
			mainaVersion: "1.5.1",
			command: "verify",
			baseUrl: "https://api.test.maina.dev",
		});

		expect(mockFetch).not.toHaveBeenCalled();
	});

	test("swallows network errors (never throws)", async () => {
		globalThis.fetch = (() =>
			Promise.reject(
				new Error("network unreachable"),
			)) as unknown as typeof fetch;

		await expect(
			sendCliErrorReport(new Error("x"), {
				mainaVersion: "1.5.1",
				command: "y",
				baseUrl: "https://api.test.maina.dev",
			}),
		).resolves.toBeUndefined();
	});

	test("resolves within timeout when server hangs", async () => {
		globalThis.fetch = ((_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				// Honour abort so AbortController can short-circuit the hang
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("aborted")),
				);
			})) as unknown as typeof fetch;

		const start = Date.now();
		await sendCliErrorReport(new Error("x"), {
			mainaVersion: "1.5.1",
			command: "y",
			baseUrl: "https://api.test.maina.dev",
			timeoutMs: 50,
		});
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(500);
	});
});
