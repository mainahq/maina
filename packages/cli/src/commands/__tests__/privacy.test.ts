/**
 * `maina privacy` (FR-PRIV-3) prints the effective collection config. The
 * test drives it against real temp HOME and repo directories through the CLI
 * fs adapter and checks every printed channel line against what core
 * resolves for the same inputs.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CollectionConfig,
	type EnvPort,
	loadCollectionConfig,
	TELEMETRY_CHANNELS,
} from "@mainahq/core";
import { nodeFs } from "../../ports";
import { privacyAction } from "../privacy";

let home: string;
let repo: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "maina-306-home-"));
	repo = mkdtempSync(join(tmpdir(), "maina-306-repo-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	rmSync(repo, { recursive: true, force: true });
});

function writeJson(dir: string, name: string, value: unknown): void {
	mkdirSync(join(dir, ".maina"), { recursive: true });
	writeFileSync(join(dir, ".maina", name), JSON.stringify(value));
}

function envOf(vars: Record<string, string>): EnvPort {
	return { get: (name) => vars[name] };
}

async function run(vars: Record<string, string>, json = false) {
	const out: string[] = [];
	const env = envOf(vars);
	const result = await privacyAction(
		{ cwd: repo, json },
		{ fs: nodeFs, env, print: (text) => out.push(text) },
	);
	const expected = await loadCollectionConfig({ fs: nodeFs, env, root: repo });
	return { result, text: out.join("\n"), expected };
}

function effective(
	expected: Awaited<ReturnType<typeof loadCollectionConfig>>,
): CollectionConfig {
	if (!expected.ok) throw new Error(JSON.stringify(expected.error));
	return expected.value;
}

const SOURCE_LABEL = {
	default: "default",
	user_policy: "user policy",
	repo_policy: "repo policy",
	legacy_config: "legacy config",
	kill_switch: "kill switch",
} as const;

function expectLinesMatch(text: string, config: CollectionConfig): void {
	for (const channel of TELEMETRY_CHANNELS) {
		const line = text.split("\n").find((l) => l.trim().startsWith(channel));
		expect(line).toBeDefined();
		const { enabled, source } = config.channels[channel];
		expect(line).toMatch(
			new RegExp(`^\\s*${channel}\\s+${enabled ? "on" : "off"}\\s+`),
		);
		expect(line).toContain(SOURCE_LABEL[source]);
	}
}

describe("maina privacy", () => {
	test("default: every channel is printed off, and says nothing is sent", async () => {
		const { result, text, expected } = await run({ HOME: home });
		expect(result.ok).toBe(true);
		const config = effective(expected);
		expectLinesMatch(text, config);
		for (const channel of TELEMETRY_CHANNELS) {
			expect(config.channels[channel].enabled).toBe(false);
		}
		expect(text).toContain("Nothing leaves this machine");
	});

	test("opt-ins, a repo opt-out and a legacy flag all print as resolved", async () => {
		writeJson(home, "policy.json", {
			telemetry: { usage: true, outcome_sharing: true },
		});
		writeFileSync(join(home, ".maina", "config.yml"), "errors: true\n");
		writeJson(repo, "policy.json", { telemetry: { usage: false } });

		const { text, expected } = await run({ HOME: home });
		const config = effective(expected);
		expect(config.channels.usage.source).toBe("repo_policy");
		expect(config.channels.outcome_sharing.enabled).toBe(true);
		expect(config.channels.crash_reports.source).toBe("legacy_config");
		expectLinesMatch(text, config);
		expect(text).not.toContain("Nothing leaves this machine");
	});

	test("a kill switch is named in the output", async () => {
		writeJson(home, "policy.json", { telemetry: { usage: true } });
		const { text, expected } = await run({ HOME: home, DO_NOT_TRACK: "1" });
		expectLinesMatch(text, effective(expected));
		expect(text).toContain("DO_NOT_TRACK");
	});

	test("--json prints the effective config in the data envelope", async () => {
		writeJson(home, "policy.json", { telemetry: { crash_reports: true } });
		const { text, expected } = await run({ HOME: home }, true);
		const parsed = JSON.parse(text) as {
			data: CollectionConfig;
			error: unknown;
		};
		expect(parsed.error).toBeNull();
		expect(parsed.data).toEqual(effective(expected));
	});

	test("each channel's description names every field that channel sends", async () => {
		const { text } = await run({ HOME: home });
		const line = (channel: string): string =>
			text.split("\n").find((l) => l.trim().startsWith(`- ${channel}:`)) ?? "";
		// CliErrorPayload fields.
		for (const field of ["Node version", "CI flag", "report id"]) {
			expect(line("crash_reports")).toContain(field);
		}
		// UsageEvent properties and the `maina setup` stack summary.
		for (const field of ["event properties", "languages", "repo size"]) {
			expect(line("usage")).toContain(field);
		}
		// Every key of the outcome share payload.
		for (const field of ["model hash", "confidence", "outcome label"]) {
			expect(line("outcome_sharing")).toContain(field);
		}
	});

	test("an invalid policy is reported, not treated as consent", async () => {
		writeJson(repo, "policy.json", { telemetry: { usage: true } });
		const { result, text } = await run({ HOME: home });
		expect(result.ok).toBe(false);
		expect(text).toContain("telemetry.usage");
	});
});
