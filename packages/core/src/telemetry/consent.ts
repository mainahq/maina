/**
 * Effective collection config (FR-PRIV-1..3): which telemetry channels may
 * send anything off this machine, and why.
 *
 * Every channel is off unless the user opts in. Sources, strongest first:
 *
 * 1. A kill switch turns everything off: `DO_NOT_TRACK=1`,
 *    `MAINA_TELEMETRY=0|false|no|off`, or `~/.maina/telemetry.json` with
 *    `{ "optOut": true }`.
 * 2. The repo policy (`<root>/.maina/policy.json`) may turn a channel off,
 *    never on.
 * 3. The user policy (`~/.maina/policy.json`) turns a channel on or off.
 * 4. The legacy 1.x opt-ins in `~/.maina/config.yml` (`errors: true` for
 *    crash reports, `telemetry: true` for usage).
 * 5. Default: off.
 *
 * Every read goes through the injected fs and env ports. Anything that fails
 * to parse is an error, and senders treat an error as "off" (fail closed).
 */

import { join } from "node:path";
import { readJsonFile } from "../config/schema";
import type { Result } from "../db/index";
import {
	type PolicyError,
	type PolicyLayer,
	type PolicySource,
	parsePolicyLayer,
} from "../policy/schema";
import type { EnvPort } from "../ports/env";
import type { FsPort } from "../ports/fs";

export const TELEMETRY_CHANNELS = [
	"crash_reports",
	"usage",
	"outcome_sharing",
] as const;

export type TelemetryChannel = (typeof TELEMETRY_CHANNELS)[number];

export type ConsentSource =
	| "default"
	| "user_policy"
	| "repo_policy"
	| "legacy_config"
	| "kill_switch";

export type ChannelConsent = Readonly<{
	enabled: boolean;
	source: ConsentSource;
}>;

export type KillSwitch = "DO_NOT_TRACK" | "MAINA_TELEMETRY" | "telemetry.json";

export type CollectionConfig = Readonly<{
	channels: Readonly<Record<TelemetryChannel, ChannelConsent>>;
	killSwitch: KillSwitch | null;
}>;

/** What consent resolution reads: the fs and env ports, and the repo root. */
export type TelemetryContext = Readonly<{
	fs: FsPort;
	env: EnvPort;
	/** Repo root whose `.maina/policy.json` may opt out; none when omitted. */
	root?: string;
}>;

export type ConsentError = Readonly<{
	kind: "invalid_policy";
	errors: readonly PolicyError[];
}>;

type Telemetry = NonNullable<PolicyLayer["telemetry"]>;

type LegacyOptIns = Readonly<Partial<Record<TelemetryChannel, boolean>>>;

/** What `resolveCollectionConfig` combines; each input already read. */
type ConsentInputs = Readonly<{
	killSwitch: KillSwitch | null;
	user: Telemetry | undefined;
	repo: Telemetry | undefined;
	legacy: LegacyOptIns;
}>;

// ── Pure resolution ─────────────────────────────────────────────────────────

function resolveChannel(
	channel: TelemetryChannel,
	inputs: ConsentInputs,
): ChannelConsent {
	if (inputs.killSwitch !== null) {
		return { enabled: false, source: "kill_switch" };
	}
	if (inputs.repo?.[channel] === false) {
		return { enabled: false, source: "repo_policy" };
	}
	const user = inputs.user?.[channel];
	if (user !== undefined) return { enabled: user, source: "user_policy" };
	if (inputs.legacy[channel] === true) {
		return { enabled: true, source: "legacy_config" };
	}
	return { enabled: false, source: "default" };
}

function resolveCollectionConfig(inputs: ConsentInputs): CollectionConfig {
	const channels = Object.fromEntries(
		TELEMETRY_CHANNELS.map((channel) => [
			channel,
			resolveChannel(channel, inputs),
		]),
	) as Record<TelemetryChannel, ChannelConsent>;
	return { channels, killSwitch: inputs.killSwitch };
}

/** Repo opt-ins the user did not make: a repo may only turn channels off. */
function repoOptInErrors(
	user: Telemetry | undefined,
	repo: Telemetry | undefined,
	file: string | undefined,
): PolicyError[] {
	return TELEMETRY_CHANNELS.filter(
		(channel) => repo?.[channel] === true && user?.[channel] !== true,
	).map((channel) => ({
		kind: "invalid",
		source: "repo",
		file,
		path: `telemetry.${channel}`,
		message:
			"Telemetry opt-ins can only be turned on in the user policy, not by a repo policy",
	}));
}

// ── Reads (through the ports) ───────────────────────────────────────────────

const ENV_OFF = new Set(["0", "false", "no", "off"]);

/** `$HOME`, or `%USERPROFILE%` on Windows; undefined when neither is set. */
function homeDir(env: EnvPort): string | undefined {
	return env.get("HOME") || env.get("USERPROFILE") || undefined;
}

function envKillSwitch(env: EnvPort): KillSwitch | null {
	const dnt = env.get("DO_NOT_TRACK")?.trim().toLowerCase();
	if (dnt === "1" || dnt === "true") return "DO_NOT_TRACK";
	const flag = env.get("MAINA_TELEMETRY")?.trim().toLowerCase();
	if (flag !== undefined && ENV_OFF.has(flag)) return "MAINA_TELEMETRY";
	return null;
}

async function fileKillSwitch(
	fs: FsPort,
	home: string | undefined,
): Promise<KillSwitch | null> {
	if (home === undefined) return null;
	const raw = await readJsonFile(fs, join(home, ".maina", "telemetry.json"));
	const optOut =
		raw.ok &&
		typeof raw.value === "object" &&
		raw.value !== null &&
		(raw.value as { optOut?: unknown }).optOut === true;
	return optOut ? "telemetry.json" : null;
}

async function readLegacyOptIns(
	fs: FsPort,
	home: string | undefined,
): Promise<LegacyOptIns> {
	if (home === undefined) return {};
	const read = await fs.readFile(join(home, ".maina", "config.yml"));
	if (!read.ok) return {};
	return {
		crash_reports: /^errors:\s*true\s*$/m.test(read.value),
		usage: /^telemetry:\s*true\s*$/m.test(read.value),
	};
}

async function readTelemetryLayer(
	fs: FsPort,
	file: string,
	source: PolicySource,
): Promise<Result<Telemetry | undefined, readonly PolicyError[]>> {
	const raw = await readJsonFile(fs, file);
	if (!raw.ok) {
		return {
			ok: false,
			error: [
				{
					kind: raw.error.kind,
					source,
					file,
					path: "",
					message: raw.error.message,
				},
			],
		};
	}
	if (raw.value === undefined) return { ok: true, value: undefined };
	const parsed = parsePolicyLayer(raw.value, source, file);
	return parsed.ok ? { ok: true, value: parsed.value.telemetry } : parsed;
}

/**
 * Reads every consent source for `ctx` and resolves the effective config.
 * Returns an error (never a guess) when a policy file is unreadable, invalid
 * or tries to opt in from the repo.
 */
export async function loadCollectionConfig(
	ctx: TelemetryContext,
): Promise<Result<CollectionConfig, ConsentError>> {
	const home = homeDir(ctx.env);
	const repoFile =
		ctx.root === undefined
			? undefined
			: join(ctx.root, ".maina", "policy.json");
	const [user, repo, legacy, fileSwitch] = await Promise.all([
		home === undefined
			? Promise.resolve({ ok: true as const, value: undefined })
			: readTelemetryLayer(ctx.fs, join(home, ".maina", "policy.json"), "user"),
		repoFile === undefined
			? Promise.resolve({ ok: true as const, value: undefined })
			: readTelemetryLayer(ctx.fs, repoFile, "repo"),
		readLegacyOptIns(ctx.fs, home),
		fileKillSwitch(ctx.fs, home),
	]);

	const errors = [
		...(user.ok ? [] : user.error),
		...(repo.ok ? [] : repo.error),
		...(user.ok && repo.ok
			? repoOptInErrors(user.value, repo.value, repoFile)
			: []),
	];
	if (errors.length > 0 || !user.ok || !repo.ok) {
		return { ok: false, error: { kind: "invalid_policy", errors } };
	}
	return {
		ok: true,
		value: resolveCollectionConfig({
			killSwitch: envKillSwitch(ctx.env) ?? fileSwitch,
			user: user.value,
			repo: repo.value,
			legacy,
		}),
	};
}

/** True only when `channel` is opted in; any read or policy error is "off". */
export async function isChannelEnabled(
	ctx: TelemetryContext,
	channel: TelemetryChannel,
): Promise<boolean> {
	const config = await loadCollectionConfig(ctx);
	return config.ok && config.value.channels[channel].enabled;
}
