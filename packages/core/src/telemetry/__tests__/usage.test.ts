import { describe, expect, test } from "bun:test";
import { envFromRecord } from "../../ports/env";
import { createMemoryFs } from "../../ports/testing";
import { buildUsageEvent, isTelemetryEnabled, trackUsageEvent } from "../usage";

describe("buildUsageEvent", () => {
	test("produces properly structured event", () => {
		const event = buildUsageEvent("maina.verify.started", {
			toolCount: 12,
		});

		expect(event.event).toBe("maina.verify.started");
		expect(event.properties.toolCount).toBe(12);
		expect(event.os).toBe(process.platform);
		expect(event.timestamp).toBeTruthy();
	});

	test("defaults to unknown version", () => {
		const event = buildUsageEvent("maina.install");
		expect(event.version).toBe("unknown");
	});

	test("accepts custom version", () => {
		const event = buildUsageEvent("maina.commit", {}, "1.1.5");
		expect(event.version).toBe("1.1.5");
	});

	test("includes no PII fields", () => {
		const event = buildUsageEvent("maina.verify.completed", {
			passed: true,
			duration: 1234,
			findings: 3,
		});

		const json = JSON.stringify(event);
		expect(json).not.toContain("email");
		expect(json).not.toContain("user");
		expect(json).not.toContain("token");
		expect(json).not.toContain("key");
	});

	test("all event names are valid", () => {
		const validNames = [
			"maina.install",
			"maina.verify.started",
			"maina.verify.completed",
			"maina.learn.ran",
			"maina.commit",
			"maina.plan",
			"maina.wiki.init",
			"maina.wiki.query",
		] as const;

		for (const name of validNames) {
			const event = buildUsageEvent(name);
			expect(event.event).toBe(name);
		}
	});
});

describe("trackUsageEvent", () => {
	const env = envFromRecord({ HOME: "/home/dev" });

	test("returns null without an opt-in", async () => {
		const ctx = { env, fs: createMemoryFs() };
		expect(await trackUsageEvent(ctx, "maina.install")).toBeNull();
	});

	test("reads the legacy telemetry: true opt-in through the fs port", async () => {
		const ctx = {
			env,
			fs: createMemoryFs({
				"/home/dev/.maina/config.yml": "telemetry: true\n",
			}),
		};
		expect(await isTelemetryEnabled(ctx)).toBe(true);
		const result = await trackUsageEvent(ctx, "maina.install");
		expect(result?.event).toBe("maina.install");
	});

	test("buildUsageEvent always works regardless of consent", () => {
		const event = buildUsageEvent("maina.commit", { duration: 500 });
		expect(event.event).toBe("maina.commit");
		expect(event.properties.duration).toBe(500);
	});
});
