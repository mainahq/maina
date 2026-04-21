import { describe, expect, test } from "bun:test";
import {
	degradedBanner,
	recoveryCommand,
	type SetupDegradedReason,
} from "../recovery";

const ALL_REASONS: SetupDegradedReason[] = [
	"host_unavailable",
	"rate_limited",
	"byok_failed",
	"no_key",
	"ai_unavailable",
	"forced",
];

describe("degradedBanner", () => {
	test("every reason has a distinct banner", () => {
		const banners = ALL_REASONS.map(degradedBanner);
		expect(new Set(banners).size).toBe(ALL_REASONS.length);
	});

	test("no_key banner names the missing key, not generic 'AI unavailable'", () => {
		const b = degradedBanner("no_key");
		expect(b.toLowerCase()).toContain("api key");
		expect(b.toLowerCase()).not.toContain("all ai tiers");
	});

	test("forced banner explicitly says 'forced'", () => {
		expect(degradedBanner("forced").toLowerCase()).toContain("forced");
	});

	test("host_unavailable banner mentions host", () => {
		expect(degradedBanner("host_unavailable").toLowerCase()).toContain("host");
	});
});

describe("recoveryCommand", () => {
	test("returns non-empty command for every reason", () => {
		const reasons: SetupDegradedReason[] = [
			"host_unavailable",
			"rate_limited",
			"byok_failed",
			"no_key",
			"ai_unavailable",
			"forced",
		];
		for (const r of reasons) {
			const cmd = recoveryCommand(r);
			expect(cmd.length).toBeGreaterThan(0);
			// Must look like a runnable hint — either a shell command or a one-line instruction
			expect(cmd).not.toMatch(/^\s*$/);
		}
	});

	test("host_unavailable recovery mentions Claude Code or host", () => {
		const cmd = recoveryCommand("host_unavailable");
		expect(cmd.toLowerCase()).toMatch(/host|claude|ollama/);
	});

	test("no_key recovery mentions an API key env var", () => {
		const cmd = recoveryCommand("no_key");
		expect(cmd).toMatch(/API_KEY|maina setup --update/);
	});

	test("rate_limited recovery mentions retry", () => {
		const cmd = recoveryCommand("rate_limited");
		expect(cmd.toLowerCase()).toContain("retry");
	});

	test("byok_failed recovery suggests doctor", () => {
		const cmd = recoveryCommand("byok_failed");
		expect(cmd.toLowerCase()).toContain("doctor");
	});

	test("forced reason still produces a helpful line", () => {
		const cmd = recoveryCommand("forced");
		expect(cmd.length).toBeGreaterThan(0);
	});
});
