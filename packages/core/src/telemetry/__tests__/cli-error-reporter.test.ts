import { describe, expect, test } from "bun:test";
import { envFromRecord } from "../../ports/env";
import type { NetworkPort } from "../../ports/network";
import { createMemoryFs, createNetworkSpy } from "../../ports/testing";
import {
	buildCliErrorPayload,
	sendCliErrorReport,
} from "../cli-error-reporter";

// Payload tests read only `CI` from the env; each test hands core its own.
const env = envFromRecord({});

const HOME = "/home/dev";
const OPTED_IN = {
	[`${HOME}/.maina/policy.json`]: JSON.stringify({
		telemetry: { crash_reports: true },
	}),
};

function sendWith(
	files: Record<string, string>,
	vars: Record<string, string> = {},
	network: NetworkPort = createNetworkSpy(),
) {
	return sendCliErrorReport(new Error("kaboom"), {
		env: envFromRecord({ HOME, ...vars }),
		fs: createMemoryFs(files),
		network,
		mainaVersion: "1.5.1",
		command: "sync pull",
		baseUrl: "https://api.test.maina.dev",
	});
}

// ── Payload shape ──────────────────────────────────────────────────────────

describe("buildCliErrorPayload", () => {
	test("produces payload matching server validator shape", () => {
		const err = new TypeError(
			"Cannot read properties of undefined (reading 'toLowerCase')",
		);
		const payload = buildCliErrorPayload(err, {
			env,
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
			env,
			mainaVersion: "1.5.1",
			argv: ["bun", "/path/cli.js", "team", "info", "--verbose"],
		});

		expect(payload.command).toBe("team info");
	});

	test("ci flag reflects CI env var", () => {
		const payload = buildCliErrorPayload(new Error("x"), {
			env: envFromRecord({ CI: "true" }),
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
			env,
			mainaVersion: "1.5.1",
			command: "verify",
		});

		expect(payload.errorMessage).not.toContain("/Users/bikash");
		expect(payload.errorStack).not.toContain("/Users/bikash");
	});

	test("scrubs /tmp/... paths down to basenames", () => {
		const err = new Error("read /tmp/weird/secret.txt failed");
		const payload = buildCliErrorPayload(err, {
			env,
			mainaVersion: "1.5.1",
			command: "verify",
		});
		expect(payload.errorMessage).not.toContain("/tmp/weird");
		expect(payload.errorMessage).toContain("secret.txt");
	});

	test("leaves fraction-looking tokens like 5/10 intact", () => {
		const err = new Error("retry 5/10 timed out");
		const payload = buildCliErrorPayload(err, {
			env,
			mainaVersion: "1.5.1",
			command: "verify",
		});
		expect(payload.errorMessage).toContain("5/10");
	});

	test("leaves API routes like /v1/cli/errors intact", () => {
		const err = new Error("POST /v1/cli/errors returned 502");
		const payload = buildCliErrorPayload(err, {
			env,
			mainaVersion: "1.5.1",
			command: "verify",
		});
		expect(payload.errorMessage).toContain("/v1/cli/errors");
	});

	test("stops command derivation at the first flag so option VALUES don't leak", () => {
		const payload = buildCliErrorPayload(new Error("boom"), {
			env,
			mainaVersion: "1.5.1",
			argv: ["bun", "/path/cli.js", "commit", "-m", "secret message"],
		});
		// Must not include "secret" from the -m value
		expect(payload.command).toBe("commit");
		expect(payload.command).not.toContain("secret");
	});

	test("wraps non-Error throws", () => {
		const payload = buildCliErrorPayload("raw string boom", {
			env,
			mainaVersion: "1.5.1",
			command: "x",
		});
		expect(payload.errorClass).toBe("Error");
		expect(payload.errorMessage).toContain("raw string boom");
	});

	test("errorId is unique across calls (pid + hrtime + uuid)", () => {
		const a = buildCliErrorPayload(new Error("x"), {
			env,
			mainaVersion: "1.5.1",
			command: "y",
		});
		const b = buildCliErrorPayload(new Error("x"), {
			env,
			mainaVersion: "1.5.1",
			command: "y",
		});
		expect(a.errorId).not.toBe(b.errorId);
	});
});

// ── Consent (opt-in) ────────────────────────────────────────────────────────

describe("sendCliErrorReport — consent", () => {
	test("sends nothing by default", async () => {
		const spy = createNetworkSpy();
		await sendWith({}, {}, spy);
		expect(spy.calls()).toEqual([]);
	});

	test("sends once the user policy opts in to crash_reports", async () => {
		const spy = createNetworkSpy();
		await sendWith(OPTED_IN, {}, spy);
		expect(spy.calls()).toHaveLength(1);
	});

	test("the legacy errors: true opt-in still counts", async () => {
		const spy = createNetworkSpy();
		await sendWith(
			{ [`${HOME}/.maina/config.yml`]: "errors: true\n" },
			{},
			spy,
		);
		expect(spy.calls()).toHaveLength(1);
	});

	const killSwitches: Record<string, string>[] = [
		{ MAINA_TELEMETRY: "0" },
		{ DO_NOT_TRACK: "1" },
	];
	for (const vars of killSwitches) {
		test(`${Object.keys(vars)[0]} beats an opt-in`, async () => {
			const spy = createNetworkSpy();
			await sendWith(OPTED_IN, vars, spy);
			expect(spy.calls()).toEqual([]);
		});
	}

	test("~/.maina/telemetry.json { optOut: true } beats an opt-in", async () => {
		const spy = createNetworkSpy();
		await sendWith(
			{
				...OPTED_IN,
				[`${HOME}/.maina/telemetry.json`]: JSON.stringify({ optOut: true }),
			},
			{},
			spy,
		);
		expect(spy.calls()).toEqual([]);
	});

	test("a malformed user policy fails closed", async () => {
		const spy = createNetworkSpy();
		await sendWith({ [`${HOME}/.maina/policy.json`]: "{ nope" }, {}, spy);
		expect(spy.calls()).toEqual([]);
	});
});

// ── Transport ───────────────────────────────────────────────────────────────

describe("sendCliErrorReport — transport", () => {
	test("POSTs the payload to /v1/cli/errors with the timeout", async () => {
		const spy = createNetworkSpy();
		await sendWith(OPTED_IN, {}, spy);
		const [call] = spy.calls();
		expect(call?.url).toBe("https://api.test.maina.dev/v1/cli/errors");
		expect(call?.timeoutMs).toBe(1000);
		expect(
			(JSON.parse(call?.body ?? "{}") as { command: string }).command,
		).toBe("sync pull");
	});

	test("swallows a failed POST (never rejects)", async () => {
		await expect(
			sendWith(OPTED_IN, {}, createNetworkSpy(503)),
		).resolves.toBeUndefined();
	});

	test("swallows a network port that rejects", async () => {
		const broken: NetworkPort = {
			post: () => Promise.reject(new Error("adapter bug")),
		};
		await expect(sendWith(OPTED_IN, {}, broken)).resolves.toBeUndefined();
	});
});
