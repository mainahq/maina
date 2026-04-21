/**
 * PostHog client tests. No real SDK, no network — every test injects a fake
 * `createPosthog` factory that records invocations.
 */

import { describe, expect, test } from "bun:test";
import { createPosthogClient } from "../posthog-client";
import { buildErrorEvent } from "../reporter";
import { buildUsageEvent } from "../usage";

interface FakeCall {
	kind: "capture" | "captureError";
	payload: unknown;
}

interface FakeState {
	factory: (apiKey: string) => {
		capture: (p: unknown) => void;
		captureException: (p: unknown) => void;
		shutdown: () => Promise<void>;
	};
	readonly calls: FakeCall[];
	readonly constructed: number;
}

function makeFake(options?: {
	throwOnConstruct?: boolean;
	hangFlushMs?: number;
}): FakeState {
	const state = { calls: [] as FakeCall[], constructed: 0 };
	const factory = (apiKey: string) => {
		state.constructed += 1;
		if (options?.throwOnConstruct) throw new Error("fake SDK boom");
		void apiKey;
		return {
			capture: (p: unknown) => {
				state.calls.push({ kind: "capture", payload: p });
			},
			captureException: (p: unknown) => {
				state.calls.push({ kind: "captureError", payload: p });
			},
			shutdown: async () => {
				if (options?.hangFlushMs && options.hangFlushMs > 0) {
					await new Promise((r) => setTimeout(r, options.hangFlushMs));
				}
			},
		};
	};
	// Live accessors so assertions see mutations after the factory runs.
	return Object.defineProperties({ factory } as FakeState, {
		calls: { get: () => state.calls },
		constructed: { get: () => state.constructed },
	}) as FakeState;
}

const STUB_USAGE = buildUsageEvent("maina.commit", { passed: true }, "1.7.0");
const STUB_ERROR = buildErrorEvent(new Error("boom"), {
	command: "verify",
	version: "1.7.0",
});

describe("posthog-client — consent gate", () => {
	test("T1: consent off — captureUsage never touches SDK", () => {
		const fake = makeFake();
		const client = createPosthogClient({
			createPosthog: fake.factory,
			apiKeyOverride: "phc_test",
			consent: { usage: false, errors: false },
		});
		client.captureUsage(STUB_USAGE);
		expect(fake.constructed).toBe(0);
		expect(fake.calls.length).toBe(0);
	});

	test("T2: consent on, no key — SDK never instantiated", () => {
		const fake = makeFake();
		const client = createPosthogClient({
			createPosthog: fake.factory,
			apiKeyOverride: "",
			consent: { usage: true, errors: true },
		});
		client.captureUsage(STUB_USAGE);
		client.captureError(STUB_ERROR);
		expect(fake.constructed).toBe(0);
		expect(fake.calls.length).toBe(0);
	});

	test("T3: consent on, key set — exactly one capture per call", () => {
		const fake = makeFake();
		const client = createPosthogClient({
			createPosthog: fake.factory,
			apiKeyOverride: "phc_test",
			consent: { usage: true, errors: true },
		});
		client.captureUsage(STUB_USAGE);
		expect(fake.constructed).toBe(1);
		expect(fake.calls.length).toBe(1);
		const captured = fake.calls[0];
		expect(captured?.kind).toBe("capture");
		const payload = captured?.payload as { event: string } | undefined;
		expect(payload?.event).toBe("maina.commit");
	});

	test("T4: errors consent is independent of usage consent", () => {
		const fake = makeFake();
		const client = createPosthogClient({
			createPosthog: fake.factory,
			apiKeyOverride: "phc_test",
			consent: { usage: true, errors: false },
		});
		client.captureUsage(STUB_USAGE);
		client.captureError(STUB_ERROR);
		expect(fake.calls.filter((c) => c.kind === "capture").length).toBe(1);
		expect(fake.calls.filter((c) => c.kind === "captureError").length).toBe(0);
	});

	test("T6: captureUsage swallows SDK construction errors", () => {
		const fake = makeFake({ throwOnConstruct: true });
		const client = createPosthogClient({
			createPosthog: fake.factory,
			apiKeyOverride: "phc_test",
			consent: { usage: true, errors: true },
		});
		// Must not throw.
		expect(() => client.captureUsage(STUB_USAGE)).not.toThrow();
		expect(fake.calls.length).toBe(0);
	});
});

describe("posthog-client — flush budget", () => {
	test("T5: flushTelemetry resolves within budget even if SDK shutdown hangs", async () => {
		const fake = makeFake({ hangFlushMs: 5_000 });
		const client = createPosthogClient({
			createPosthog: fake.factory,
			apiKeyOverride: "phc_test",
			consent: { usage: true, errors: true },
		});
		// Force SDK instantiation so flush has something to shut down.
		client.captureUsage(STUB_USAGE);

		const start = Date.now();
		await client.flush(200);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(1_000);
	});

	test("flushTelemetry is a no-op when SDK was never instantiated", async () => {
		const fake = makeFake();
		const client = createPosthogClient({
			createPosthog: fake.factory,
			apiKeyOverride: "phc_test",
			consent: { usage: false, errors: false },
		});
		await client.flush(100);
		expect(fake.constructed).toBe(0);
	});
});
