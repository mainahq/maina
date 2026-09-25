/**
 * Telemetry reads its environment through an injected `EnvPort` (issue #292),
 * never `process.env`. Each test poisons `process.env` with the opposite
 * value so a module that still reads the live environment fails loudly.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFromRecord } from "../../ports/env";
import {
	buildCliErrorPayload,
	isCliTelemetryOptedOut,
	sendCliErrorReport,
} from "../cli-error-reporter";
import { createPosthogClient } from "../posthog-client";
import { buildErrorEvent } from "../reporter";
import { buildUsageEvent } from "../usage";

const POISONED = [
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CURSOR",
	"CI",
	"MAINA_TELEMETRY",
	"DO_NOT_TRACK",
	"MAINA_CLOUD_URL",
	"MAINA_POSTHOG_API_KEY",
	"MAINA_DEVICE_FINGERPRINT",
	"MAINA_POSTHOG_HOST",
] as const;

let saved: Record<string, string | undefined> = {};
let home: string;

beforeEach(() => {
	saved = {};
	for (const key of [...POISONED, "HOME"]) saved[key] = process.env[key];
	home = mkdtempSync(join(tmpdir(), "maina-292-telemetry-"));
});

afterEach(() => {
	for (const [key, prev] of Object.entries(saved)) {
		if (prev === undefined) delete process.env[key];
		else process.env[key] = prev;
	}
	rmSync(home, { recursive: true, force: true });
});

describe("reporter — agent detection", () => {
	test("detects the host agent from the injected env", () => {
		process.env.CLAUDECODE = "1";
		const event = buildErrorEvent(new Error("x"), {
			env: envFromRecord({ CURSOR: "1" }),
		});
		expect(event.agent).toBe("cursor");
	});

	test("reports no agent when the injected env names none", () => {
		process.env.CLAUDECODE = "1";
		const event = buildErrorEvent(new Error("x"), { env: envFromRecord({}) });
		expect(event.agent).toBe("none");
	});
});

describe("cli-error-reporter — consent and payload", () => {
	test("opt-out flags come from the injected env, not process.env", () => {
		process.env.MAINA_TELEMETRY = "0";
		process.env.DO_NOT_TRACK = "1";
		expect(isCliTelemetryOptedOut(envFromRecord({ HOME: home }))).toBe(false);
		expect(
			isCliTelemetryOptedOut(
				envFromRecord({ HOME: home, MAINA_TELEMETRY: "0" }),
			),
		).toBe(true);
		expect(
			isCliTelemetryOptedOut(envFromRecord({ HOME: home, DO_NOT_TRACK: "1" })),
		).toBe(true);
	});

	test("the telemetry.json opt-out is read under the injected HOME", () => {
		mkdirSync(join(home, ".maina"), { recursive: true });
		writeFileSync(
			join(home, ".maina", "telemetry.json"),
			JSON.stringify({ optOut: true }),
		);
		process.env.HOME = tmpdir();
		expect(isCliTelemetryOptedOut(envFromRecord({ HOME: home }))).toBe(true);
	});

	test("the ci flag comes from the injected env", () => {
		process.env.CI = "true";
		const quiet = buildCliErrorPayload(new Error("x"), {
			mainaVersion: "1.0.0",
			command: "verify",
			env: envFromRecord({}),
		});
		expect(quiet.ci).toBe(false);
		delete process.env.CI;
		const ci = buildCliErrorPayload(new Error("x"), {
			mainaVersion: "1.0.0",
			command: "verify",
			env: envFromRecord({ CI: "true" }),
		});
		expect(ci.ci).toBe(true);
	});

	test("the cloud URL comes from the injected env", async () => {
		process.env.MAINA_CLOUD_URL = "https://wrong.example";
		const urls: string[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request) => {
			urls.push(String(input));
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		try {
			await sendCliErrorReport(new Error("x"), {
				mainaVersion: "1.0.0",
				command: "verify",
				env: envFromRecord({
					HOME: home,
					MAINA_CLOUD_URL: "https://cloud.test",
				}),
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(urls).toEqual(["https://cloud.test/v1/cli/errors"]);
	});
});

describe("posthog-client — key and identity", () => {
	test("the API key and device fingerprint come from the injected env", () => {
		process.env.MAINA_POSTHOG_API_KEY = "phc_wrong";
		process.env.MAINA_DEVICE_FINGERPRINT = "wrong";
		const keys: string[] = [];
		const ids: string[] = [];
		const client = createPosthogClient({
			env: envFromRecord({
				MAINA_POSTHOG_API_KEY: "phc_injected",
				MAINA_DEVICE_FINGERPRINT: "fp-292",
			}),
			consent: { usage: true, errors: true },
			createPosthog: (apiKey) => {
				keys.push(apiKey);
				return {
					capture: (input) => ids.push(input.distinctId),
					captureException: () => {},
					shutdown: async () => {},
				};
			},
		});
		client.captureUsage(buildUsageEvent("maina.commit", {}, "1.0.0"));
		expect(keys).toEqual(["phc_injected"]);
		expect(ids).toEqual(["maina:fp-292"]);
	});

	test("no key in the injected env disables the SDK", () => {
		process.env.MAINA_POSTHOG_API_KEY = "phc_wrong";
		let constructed = 0;
		const client = createPosthogClient({
			env: envFromRecord({}),
			consent: { usage: true, errors: true },
			createPosthog: () => {
				constructed += 1;
				return {
					capture: () => {},
					captureException: () => {},
					shutdown: async () => {},
				};
			},
		});
		client.captureUsage(buildUsageEvent("maina.commit", {}, "1.0.0"));
		expect(constructed).toBe(0);
	});
});

describe("posthog-client — host", () => {
	function hostSeen(vars: Record<string, string>): string[] {
		const hosts: string[] = [];
		const client = createPosthogClient({
			env: envFromRecord({ MAINA_POSTHOG_API_KEY: "phc_injected", ...vars }),
			consent: { usage: true, errors: true },
			createPosthog: (_apiKey, host) => {
				hosts.push(host);
				return {
					capture: () => {},
					captureException: () => {},
					shutdown: async () => {},
				};
			},
		});
		client.captureUsage(buildUsageEvent("maina.commit", {}, "1.0.0"));
		return hosts;
	}

	test("the SDK is built for the MAINA_POSTHOG_HOST from the injected env", () => {
		process.env.MAINA_POSTHOG_HOST = "https://wrong.example";
		expect(hostSeen({ MAINA_POSTHOG_HOST: "https://ph.test" })).toEqual([
			"https://ph.test",
		]);
	});

	test("falls back to the EU host when the injected env names none", () => {
		process.env.MAINA_POSTHOG_HOST = "https://wrong.example";
		expect(hostSeen({})).toEqual(["https://eu.i.posthog.com"]);
	});
});
