/**
 * Effective collection config (FR-PRIV-1..3): every channel is off unless the
 * user opts in, a repo can only turn a channel off, and a kill switch beats
 * everything. All reads go through the injected fs and env ports: the real
 * home directory and `process.env` are never consulted.
 */

import { describe, expect, test } from "bun:test";
import { createFakeEnv, createMemoryFs } from "../../ports/testing";
import {
	loadCollectionConfig,
	TELEMETRY_CHANNELS,
	type TelemetryContext,
} from "../consent";

const HOME = "/home/dev";
const ROOT = "/work/repo";

function ctx(
	files: Record<string, string> = {},
	env: Record<string, string> = { HOME },
	root: string | undefined = ROOT,
): TelemetryContext {
	return {
		fs: createMemoryFs(files),
		env: createFakeEnv(env),
		...(root === undefined ? {} : { root }),
	};
}

const userPolicy = (telemetry: Record<string, boolean>) => ({
	[`${HOME}/.maina/policy.json`]: JSON.stringify({ telemetry }),
});
const repoPolicy = (telemetry: Record<string, boolean>) => ({
	[`${ROOT}/.maina/policy.json`]: JSON.stringify({ telemetry }),
});

async function load(c: TelemetryContext) {
	const result = await loadCollectionConfig(c);
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}

describe("loadCollectionConfig — defaults", () => {
	test("with no files and no env every channel is off by default", async () => {
		const config = await load(ctx());
		for (const channel of TELEMETRY_CHANNELS) {
			expect(config.channels[channel]).toEqual({
				enabled: false,
				source: "default",
			});
		}
		expect(config.killSwitch).toBeNull();
	});

	test("with no HOME and no root nothing is read and everything is off", async () => {
		const config = await load(ctx(userPolicy({ usage: true }), {}, undefined));
		expect(config.channels.usage.enabled).toBe(false);
	});
});

describe("loadCollectionConfig — opt-ins", () => {
	test("the user policy turns a channel on", async () => {
		const config = await load(ctx(userPolicy({ crash_reports: true })));
		expect(config.channels.crash_reports).toEqual({
			enabled: true,
			source: "user_policy",
		});
		expect(config.channels.usage.enabled).toBe(false);
	});

	test("USERPROFILE stands in for HOME", async () => {
		const config = await load(
			ctx(userPolicy({ usage: true }), { USERPROFILE: HOME }),
		);
		expect(config.channels.usage.enabled).toBe(true);
	});

	test("legacy ~/.maina/config.yml opt-ins are read through the fs port", async () => {
		const config = await load(
			ctx({
				[`${HOME}/.maina/config.yml`]: "errors: true\ntelemetry: true\n",
			}),
		);
		expect(config.channels.crash_reports).toEqual({
			enabled: true,
			source: "legacy_config",
		});
		expect(config.channels.usage).toEqual({
			enabled: true,
			source: "legacy_config",
		});
		expect(config.channels.outcome_sharing.enabled).toBe(false);
	});

	test("an explicit user-policy false beats a legacy opt-in", async () => {
		const config = await load(
			ctx({
				[`${HOME}/.maina/config.yml`]: "telemetry: true\n",
				...userPolicy({ usage: false }),
			}),
		);
		expect(config.channels.usage).toEqual({
			enabled: false,
			source: "user_policy",
		});
	});

	test("a repo policy can turn a user opt-in off", async () => {
		const config = await load(
			ctx({ ...userPolicy({ usage: true }), ...repoPolicy({ usage: false }) }),
		);
		expect(config.channels.usage).toEqual({
			enabled: false,
			source: "repo_policy",
		});
	});

	test("a repo policy cannot opt in on its own", async () => {
		const result = await loadCollectionConfig(
			ctx(repoPolicy({ outcome_sharing: true })),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_policy");
	});

	test("an invalid user policy is an error, not a silent opt-in", async () => {
		const result = await loadCollectionConfig(
			ctx({ [`${HOME}/.maina/policy.json`]: "{ nope" }),
		);
		expect(result.ok).toBe(false);
	});
});

describe("loadCollectionConfig — kill switches", () => {
	for (const [name, env] of [
		["DO_NOT_TRACK", { HOME, DO_NOT_TRACK: "1" }],
		["MAINA_TELEMETRY", { HOME, MAINA_TELEMETRY: "0" }],
		["MAINA_TELEMETRY", { HOME, MAINA_TELEMETRY: "off" }],
	] as const) {
		test(`${name}=${Object.values(env)[1]} turns every opted-in channel off`, async () => {
			const config = await load(
				ctx(
					userPolicy({
						crash_reports: true,
						usage: true,
						outcome_sharing: true,
					}),
					env,
				),
			);
			expect(config.killSwitch).toBe(name);
			for (const channel of TELEMETRY_CHANNELS) {
				expect(config.channels[channel]).toEqual({
					enabled: false,
					source: "kill_switch",
				});
			}
		});
	}

	test("~/.maina/telemetry.json { optOut: true } is a kill switch", async () => {
		const config = await load(
			ctx({
				...userPolicy({ crash_reports: true }),
				[`${HOME}/.maina/telemetry.json`]: JSON.stringify({ optOut: true }),
			}),
		);
		expect(config.killSwitch).toBe("telemetry.json");
		expect(config.channels.crash_reports.enabled).toBe(false);
	});

	test("MAINA_TELEMETRY=1 does not opt anything in", async () => {
		const config = await load(ctx({}, { HOME, MAINA_TELEMETRY: "1" }));
		for (const channel of TELEMETRY_CHANNELS) {
			expect(config.channels[channel].enabled).toBe(false);
		}
	});
});
