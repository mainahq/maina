/**
 * `maina privacy` (FR-PRIV-3): prints the effective collection config, what
 * each channel would send when on, and how to opt in or switch everything
 * off. Thin wrapper over core's `loadCollectionConfig`.
 */

import {
	type CollectionConfig,
	type ConsentError,
	type ConsentSource,
	type EnvPort,
	type FsPort,
	loadCollectionConfig,
	TELEMETRY_CHANNELS,
	type TelemetryChannel,
} from "@mainahq/core";
import { Command } from "commander";
import { processEnv } from "../env";
import { EXIT_CONFIG_ERROR } from "../json";
import { nodeFs } from "../ports";

interface PrivacyActionOptions {
	cwd: string;
	json?: boolean;
}

interface PrivacyDeps {
	fs: FsPort;
	env: EnvPort;
	print: (text: string) => void;
}

type PrivacyResult =
	| Readonly<{ ok: true; value: CollectionConfig }>
	| Readonly<{ ok: false; error: ConsentError }>;

const SOURCE_LABEL: Readonly<Record<ConsentSource, string>> = {
	default: "default",
	user_policy: "user policy (~/.maina/policy.json)",
	repo_policy: "repo policy (.maina/policy.json)",
	legacy_config: "legacy config (~/.maina/config.yml)",
	kill_switch: "kill switch",
};

const SENDS: Readonly<Record<TelemetryChannel, string>> = {
	crash_reports:
		"error class, scrubbed message and stack, maina version, OS, arch, command name",
	usage: "event name (such as maina.commit), OS, runtime, maina version",
	outcome_sharing:
		"decision type, answer label, confidence, final action, latency, host, outcome label",
};

function renderReport(config: CollectionConfig): string {
	const width = Math.max(...TELEMETRY_CHANNELS.map((c) => c.length)) + 3;
	const rows = TELEMETRY_CHANNELS.map((channel) => {
		const { enabled, source } = config.channels[channel];
		return `  ${channel.padEnd(width)}${(enabled ? "on" : "off").padEnd(7)}${SOURCE_LABEL[source]}`;
	});
	const anyOn = TELEMETRY_CHANNELS.some((c) => config.channels[c].enabled);
	return [
		"maina privacy: what may be sent off this machine",
		"",
		`  ${"channel".padEnd(width)}${"state".padEnd(7)}set by`,
		...rows,
		"",
		...(config.killSwitch === null
			? []
			: [`Kill switch: ${config.killSwitch} turns every channel off.`]),
		...(anyOn ? [] : ["Nothing leaves this machine: every channel is off."]),
		"",
		"When on, each channel sends only:",
		...TELEMETRY_CHANNELS.map((c) => `  - ${c}: ${SENDS[c]}`),
		"",
		"Always local: the decision log, outcomes, code, diffs and file paths.",
		'Opt in: add { "telemetry": { "<channel>": true } } to ~/.maina/policy.json',
		"Switch everything off: DO_NOT_TRACK=1 or MAINA_TELEMETRY=0",
	].join("\n");
}

function renderError(error: ConsentError): string {
	return [
		"maina privacy: the collection config could not be read, so nothing is sent.",
		...error.errors.map(
			(e) =>
				`  ${e.file ?? e.source}${e.path ? ` ${e.path}` : ""}: ${e.message}`,
		),
	].join("\n");
}

/** Resolves and prints the effective collection config for `cwd`. */
export async function privacyAction(
	options: PrivacyActionOptions,
	deps: PrivacyDeps,
): Promise<PrivacyResult> {
	const result = await loadCollectionConfig({
		fs: deps.fs,
		env: deps.env,
		root: options.cwd,
	});
	if (options.json) {
		deps.print(
			JSON.stringify(
				result.ok
					? { data: result.value, error: null, meta: { command: "privacy" } }
					: { data: null, error: result.error, meta: { command: "privacy" } },
				null,
				2,
			),
		);
	} else {
		deps.print(
			result.ok ? renderReport(result.value) : renderError(result.error),
		);
	}
	return result;
}

export function privacyCommand(): Command {
	return new Command("privacy")
		.description("Show what maina may send off this machine, and why")
		.option("--json", "Print the effective collection config as JSON")
		.action(async (opts: { json?: boolean }) => {
			const result = await privacyAction(
				{ cwd: process.cwd(), json: opts.json === true },
				{
					fs: nodeFs,
					env: processEnv,
					print: (text) => process.stdout.write(`${text}\n`),
				},
			);
			if (!result.ok) process.exitCode = EXIT_CONFIG_ERROR;
		});
}
