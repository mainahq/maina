import { describe, expect, test } from "bun:test";
import {
	buildCloudErrorEvent,
	isCloudReportingEnabled,
	reportCloudError,
} from "../cloud-reporter";

const baseContext = { command: "verify", version: "1.1.5" };
const cloudContext = {
	userId: "user_abc123",
	orgId: "org_xyz789",
	planTier: "team" as const,
};

// ── isCloudReportingEnabled ─────────────────────────────────────────────

describe("isCloudReportingEnabled", () => {
	test("returns true by default (opt-out model)", () => {
		expect(isCloudReportingEnabled(cloudContext)).toBe(true);
	});

	test("returns false when user opted out", () => {
		expect(isCloudReportingEnabled({ ...cloudContext, optedOut: true })).toBe(
			false,
		);
	});

	test("returns true when optedOut is explicitly false", () => {
		expect(isCloudReportingEnabled({ ...cloudContext, optedOut: false })).toBe(
			true,
		);
	});
});

// ── buildCloudErrorEvent ────────────────────────────────────────────────

describe("buildCloudErrorEvent", () => {
	test("extends base event with cloud metadata", () => {
		const event = buildCloudErrorEvent(
			new Error("timeout"),
			baseContext,
			cloudContext,
		);

		// Base fields
		expect(event.event).toBe("maina.error");
		expect(event.errorClass).toBe("Error");
		expect(event.message).toContain("timeout");
		expect(event.command).toBe("verify");
		expect(event.version).toBe("1.1.5");

		// Cloud fields
		expect(event.userId).toBe("user_abc123");
		expect(event.orgId).toBe("org_xyz789");
		expect(event.planTier).toBe("team");
	});

	test("never includes email or name in serialized output", () => {
		const event = buildCloudErrorEvent(
			new Error("fail for admin@company.com"),
			baseContext,
			cloudContext,
		);

		const json = JSON.stringify(event);
		// Email should be scrubbed by the base reporter's PII scrubber
		expect(json).not.toContain("admin@company.com");
		// Ensure no name/email fields exist
		expect(event).not.toHaveProperty("email");
		expect(event).not.toHaveProperty("name");
		expect(event).not.toHaveProperty("username");
	});

	test("scrubs PII from error message", () => {
		const event = buildCloudErrorEvent(
			new Error("Error at /Users/bikash/code/src/db.ts"),
			baseContext,
			cloudContext,
		);
		expect(event.message).not.toContain("/Users/bikash");
	});

	test("includes all plan tiers", () => {
		for (const tier of ["free", "team", "enterprise"] as const) {
			const event = buildCloudErrorEvent(new Error("test"), baseContext, {
				...cloudContext,
				planTier: tier,
			});
			expect(event.planTier).toBe(tier);
		}
	});
});

// ── reportCloudError ────────────────────────────────────────────────────

describe("reportCloudError", () => {
	test("returns event when reporting is enabled", () => {
		const result = reportCloudError(
			new Error("test"),
			baseContext,
			cloudContext,
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).not.toBeNull();
			expect(result.value?.userId).toBe("user_abc123");
		}
	});

	test("returns null when user opted out", () => {
		const result = reportCloudError(new Error("test"), baseContext, {
			...cloudContext,
			optedOut: true,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBeNull();
		}
	});

	test("returns Result with error ID", () => {
		const result = reportCloudError(
			new Error("test"),
			baseContext,
			cloudContext,
		);

		expect(result.ok).toBe(true);
		if (result.ok && result.value) {
			expect(result.value.errorId).toMatch(/^ERR-[a-z0-9]{6}$/);
		}
	});
});
