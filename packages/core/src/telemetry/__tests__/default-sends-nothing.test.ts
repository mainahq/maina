/**
 * FR-PRIV-1: with the default config nothing leaves the machine. Every sender
 * gets a network port spy, and `globalThis.fetch` is trapped as well, so a
 * sender that bypasses the port fails the test too. The opted-in cases prove
 * the spy is the path that is actually used.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { hashValue } from "../../decide/log/hash";
import type { DecisionRecord } from "../../decide/log/schema";
import type { OutcomeRecord } from "../../decide/outcomes/types";
import {
	createFakeEnv,
	createMemoryFs,
	createNetworkSpy,
} from "../../ports/testing";
import { sendCliErrorReport } from "../cli-error-reporter";
import { shareOutcomes } from "../outcome-share";
import { createPosthogClient, type PosthogLike } from "../posthog-client";
import { buildErrorEvent } from "../reporter";
import { buildUsageEvent } from "../usage";

const HOME = "/home/dev";
const HASH = hashValue("model");

let fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
	fetchCalls = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		fetchCalls.push(String(input));
		return new Response(null, { status: 202 });
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function optedIn(): Record<string, string> {
	return {
		[`${HOME}/.maina/policy.json`]: JSON.stringify({
			telemetry: { crash_reports: true, usage: true, outcome_sharing: true },
		}),
	};
}

function context(files: Record<string, string> = {}) {
	return {
		fs: createMemoryFs(files),
		env: createFakeEnv({ HOME, MAINA_POSTHOG_API_KEY: "phc_test" }),
		network: createNetworkSpy(),
	};
}

const DECISION: DecisionRecord = {
	id: "dec-1",
	ts: 1_700_000_000_000,
	type: "slop",
	inputHash: HASH,
	schemaHash: HASH,
	optionOrder: [true, false],
	policyHash: HASH,
	modelHash: HASH,
	distribution: [
		{ answer: true, p: 0.9 },
		{ answer: false, p: 0.1 },
	],
	answer: true,
	finalAction: "flag",
	latencyMs: 3,
};

const OUTCOME: OutcomeRecord = {
	id: "out-1",
	decisionId: "dec-1",
	outcome: "dismissed",
	source: "gate",
	ts: 1_700_000_000_500,
};

function fakePosthog() {
	const calls: string[] = [];
	let constructed = 0;
	const factory = (): PosthogLike => {
		constructed += 1;
		return {
			capture: (input) => calls.push(input.event),
			captureException: () => calls.push("exception"),
			shutdown: async () => {},
		};
	};
	return { factory, calls, constructed: () => constructed };
}

describe("default config sends nothing", () => {
	test("crash reports: no POST on the port, no fetch", async () => {
		const c = context();
		await sendCliErrorReport(new Error("boom"), {
			...c,
			mainaVersion: "1.0.0",
			command: "verify",
		});
		expect(c.network.calls()).toEqual([]);
		expect(fetchCalls).toEqual([]);
	});

	test("usage and error events: the PostHog SDK is never built", async () => {
		const c = context();
		const ph = fakePosthog();
		const client = createPosthogClient({ ...c, createPosthog: ph.factory });
		client.captureUsage(buildUsageEvent("maina.commit", {}, "1.0.0"));
		client.captureError(buildErrorEvent(new Error("x"), { env: c.env }));
		await client.flush(100);
		expect(ph.constructed()).toBe(0);
		expect(ph.calls).toEqual([]);
		expect(fetchCalls).toEqual([]);
	});

	test("outcome sharing: no POST on the port, no fetch", async () => {
		const c = context();
		const result = await shareOutcomes(
			c,
			[{ decision: DECISION, outcome: OUTCOME }],
			{ baseUrl: "https://cloud.test" },
		);
		expect(result).toEqual({
			ok: true,
			value: { sent: 0, skipped: "not_opted_in" },
		});
		expect(c.network.calls()).toEqual([]);
		expect(fetchCalls).toEqual([]);
	});
});

describe("opted in, every send goes through the port", () => {
	test("crash reports POST once through the port", async () => {
		const c = context(optedIn());
		await sendCliErrorReport(new Error("boom"), {
			...c,
			mainaVersion: "1.0.0",
			command: "verify",
			baseUrl: "https://cloud.test",
		});
		expect(c.network.calls().map((r) => r.url)).toEqual([
			"https://cloud.test/v1/cli/errors",
		]);
		expect(fetchCalls).toEqual([]);
	});

	test("usage and error events reach the SDK", async () => {
		const c = context(optedIn());
		const ph = fakePosthog();
		const client = createPosthogClient({ ...c, createPosthog: ph.factory });
		client.captureUsage(buildUsageEvent("maina.commit", {}, "1.0.0"));
		client.captureError(buildErrorEvent(new Error("x"), { env: c.env }));
		await client.flush(100);
		expect(ph.calls.sort()).toEqual(["exception", "maina.commit"]);
	});

	test("outcomes POST once through the port", async () => {
		const c = context(optedIn());
		const result = await shareOutcomes(
			c,
			[{ decision: DECISION, outcome: OUTCOME }],
			{ baseUrl: "https://cloud.test" },
		);
		expect(result).toEqual({ ok: true, value: { sent: 1 } });
		expect(c.network.calls().map((r) => r.url)).toEqual([
			"https://cloud.test/v1/outcomes",
		]);
		expect(fetchCalls).toEqual([]);
	});
});
