/**
 * `maina cloud` (#589, spec §6.3, FR-ID-6, FR-PRIV-3): this machine's
 * Maina Link identity.
 *
 *   maina cloud enrol [--ci] [--label <label>]
 *       enrol this device: show a code for a member to approve, generate the
 *       device key here, store it owner-only. `--ci` enrols a CI runner
 *       with the scoped API token in MAINA_LINK_CI_TOKEN (never argv).
 *   maina cloud status [--json] [--check]
 *       enrolled, revoked or not; `--check` also buys a token, which is how
 *       a revocation shows up before any other Link call
 *   maina cloud logout            (alias: unenrol)
 *       forget the device key and enrolment on this machine
 *   maina cloud privacy [--class metadata|names|rich] [--json]
 *       exactly what Link sends at a data class (the device's by default),
 *       printed from the vendored protocol's privacy.json
 *
 * The Link client lives in the runtime (`packages/runtime/src/link`); this
 * module parses arguments and formats. The cloud is MAINA_CLOUD_URL, else
 * the hosted cloud (shared with the 1.x client, `cloudBaseUrl`). Exit codes:
 * 0 done, 1 failed, 64 bad arguments. The 1.x `maina login` stays for the
 * legacy cloud features.
 */

import { homedir } from "node:os";
import { cloudBaseUrl, type EnvPort, VERSION } from "@mainahq/core";
import {
	type EnrolError,
	type EnrolPorts,
	enrolDevice,
} from "@mainahq/runtime/src/link/enrol";
import { nodeLinkCrypto } from "@mainahq/runtime/src/link/keys";
import {
	parseDataClass,
	privacyReport,
	renderPrivacy,
} from "@mainahq/runtime/src/link/privacy";
import {
	type DeviceStatus,
	deviceStatus,
	fileLinkStore,
	linkDir,
	type StoreError,
} from "@mainahq/runtime/src/link/store";
import { linkToken } from "@mainahq/runtime/src/link/token";
import { Command } from "commander";
import { processEnv } from "../env";
import { fetchHttp } from "../ports";

export type CloudPorts = Readonly<{
	link: EnrolPorts;
	env: EnvPort;
	device: Readonly<{ os: string; arch: string; runtimeVersion: string }>;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}>;

const USAGE = `usage: maina cloud enrol [--ci] [--label <label>]
       maina cloud status [--json] [--check]
       maina cloud logout
       maina cloud privacy [--class metadata|names|rich] [--json]

  enrol    enrol this device with Maina Cloud (CI: token in MAINA_LINK_CI_TOKEN)
  status   whether this device is enrolled, and where
  logout   forget this device's key and enrolment (alias: unenrol)
  privacy  exactly what Link sends at a data class
`;

const CI_TOKEN_VAR = "MAINA_LINK_CI_TOKEN";

// ── Argument parsing ────────────────────────────────────────────────────────

type Flags = Readonly<{
	bools: ReadonlySet<string>;
	values: ReadonlyMap<string, string>;
}>;

/** `--flag` and `--name value` pairs, or null on anything else. */
function parseFlags(
	args: readonly string[],
	bools: readonly string[],
	valued: readonly string[],
): Flags | null {
	const seen = new Set<string>();
	const values = new Map<string, string>();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (bools.includes(arg)) seen.add(arg);
		else if (valued.includes(arg) && i + 1 < args.length) {
			values.set(arg, args[i + 1] ?? "");
			i++;
		} else return null;
	}
	return { bools: seen, values };
}

// ── Messages ────────────────────────────────────────────────────────────────

function storeMessage(e: StoreError): string {
	switch (e.kind) {
		case "store":
			return `cannot ${e.op} the device files: ${e.message}`;
		case "insecure_key":
			return `${e.path} is readable by others (mode ${e.mode.toString(8)}); run \`chmod 600 ${e.path}\` or \`maina cloud logout\``;
		case "corrupt_state":
			return `${e.path} is not a device enrolment (${e.message}); run \`maina cloud logout\``;
		default: {
			const unreachable: never = e;
			return unreachable;
		}
	}
}

function failureMessage(e: EnrolError): string {
	switch (e.kind) {
		case "already_enrolled":
			return `this device is already enrolled as ${e.deviceId}; run \`maina cloud logout\` first`;
		case "invalid_request":
			return `the enrolment request is not valid: ${e.problems.join("; ")}`;
		case "invalid_message":
			return `a ${e.message} message is not valid: ${e.problems.join("; ")}`;
		case "expired":
			return "the code expired before it was approved; run `maina cloud enrol` again";
		case "org_keys_incomplete":
			return `the org has no ${e.missing.join(", ")} key yet; try again later`;
		case "not_enrolled":
			return "this device is not enrolled; run `maina cloud enrol`";
		case "revoked":
			return `this device was revoked at ${e.revokedAt}`;
		case "insecure_url":
			return `refusing ${e.url}: the cloud must be https (http only to localhost)`;
		case "network":
			return `cannot reach the cloud: ${e.message}`;
		case "refused":
			return `the cloud refused (${e.code})${e.message === "" ? "" : `: ${e.message}`}`;
		case "invalid_response":
			return `unexpected answer from the cloud: ${e.message}`;
		case "crypto":
			return `device key operation failed: ${e.message}`;
		case "store":
		case "insecure_key":
		case "corrupt_state":
			return storeMessage(e);
		default: {
			const unreachable: never = e;
			return unreachable;
		}
	}
}

function renderStatus(status: DeviceStatus): string {
	switch (status.kind) {
		case "not_enrolled":
			return "Maina Link: not enrolled (run `maina cloud enrol`)\n";
		case "unreadable":
			return `Maina Link: unreadable: ${storeMessage(status.error)}\n`;
		case "enrolled":
		case "revoked": {
			const head =
				status.kind === "enrolled"
					? "Maina Link: enrolled"
					: `Maina Link: revoked at ${status.revokedAt} (Link is stopped)`;
			const lines = [
				head,
				`  device:     ${status.deviceId} (${status.deviceKind})`,
				`  org:        ${status.orgId}`,
				`  cloud:      ${status.baseUrl}`,
				`  enrolled:   ${status.enrolledAt}`,
				`  data class: ${status.dataClass}`,
				`  org keys:   ${status.orgKeys.map((k) => `${k.keyId} (${k.purpose})`).join(", ")}`,
			];
			if (status.kind === "revoked") {
				lines.push(
					"  An admin revoked this device. Run `maina cloud logout`, then `maina cloud enrol` to enrol again.",
				);
			}
			return `${lines.join("\n")}\n`;
		}
		default: {
			const unreachable: never = status;
			return unreachable;
		}
	}
}

// ── Subcommands ─────────────────────────────────────────────────────────────

async function enrol(
	args: readonly string[],
	ports: CloudPorts,
): Promise<number> {
	const flags = parseFlags(args, ["--ci"], ["--label"]);
	if (flags === null) {
		ports.stderr(USAGE);
		return 64;
	}
	let ciToken: string | undefined;
	if (flags.bools.has("--ci")) {
		ciToken = ports.env.get(CI_TOKEN_VAR);
		if (ciToken === undefined || ciToken === "") {
			ports.stderr(
				`maina cloud enrol: --ci needs the CI-enrolment API token in ${CI_TOKEN_VAR}\n`,
			);
			return 1;
		}
	}
	const label = flags.values.get("--label");
	const enrolled = await enrolDevice(ports.link, {
		baseUrl: cloudBaseUrl(ports.env),
		...(ciToken === undefined ? {} : { ciToken }),
		device: { ...ports.device, ...(label === undefined ? {} : { label }) },
		onUserCode: ({ userCode, verificationUri, expiresIn }) => {
			ports.stdout(
				`To enrol this device, open ${verificationUri} and enter:\n\n    ${userCode}\n\nWaiting for approval (the code expires in ${Math.round(expiresIn / 60)} minutes)...\n`,
			);
		},
	});
	if (!enrolled.ok) {
		ports.stderr(`maina cloud enrol: ${failureMessage(enrolled.error)}\n`);
		return 1;
	}
	const { enrolment, baseUrl } = enrolled.value;
	ports.stdout(
		`Enrolled ${enrolment.deviceId} in org ${enrolment.orgId} (${baseUrl}).\n`,
	);
	return 0;
}

async function status(
	args: readonly string[],
	ports: CloudPorts,
): Promise<number> {
	const flags = parseFlags(args, ["--json", "--check"], []);
	if (flags === null) {
		ports.stderr(USAGE);
		return 64;
	}
	let check: string | undefined;
	if (
		flags.bools.has("--check") &&
		deviceStatus(ports.link.store).kind === "enrolled"
	) {
		const token = await linkToken(ports.link);
		check = token.ok ? "token exchange ok" : failureMessage(token.error);
	}
	// Read after the check: a `device_revoked` answer has marked the state.
	const current = deviceStatus(ports.link.store);
	if (flags.bools.has("--json")) {
		const shown =
			current.kind === "unreadable"
				? { kind: "unreadable", error: storeMessage(current.error) }
				: current;
		ports.stdout(
			`${JSON.stringify(check === undefined ? shown : { ...shown, check })}\n`,
		);
	} else {
		ports.stdout(renderStatus(current));
		if (check !== undefined) ports.stdout(`  check:      ${check}\n`);
	}
	return current.kind === "unreadable" ? 1 : 0;
}

function logout(args: readonly string[], ports: CloudPorts): number {
	if (args.length > 0) {
		ports.stderr(USAGE);
		return 64;
	}
	const current = deviceStatus(ports.link.store);
	if (current.kind === "not_enrolled") {
		ports.stdout("Maina Link: not enrolled; nothing to forget\n");
		return 0;
	}
	const cleared = ports.link.store.clear();
	if (!cleared.ok) {
		ports.stderr(`maina cloud logout: ${storeMessage(cleared.error)}\n`);
		return 1;
	}
	ports.stdout(
		current.kind === "unreadable"
			? "Forgot this device's Link files.\n"
			: `Forgot ${current.deviceId} (org ${current.orgId}) on this machine. The org still lists it until an admin revokes it.\n`,
	);
	return 0;
}

function privacy(args: readonly string[], ports: CloudPorts): number {
	const flags = parseFlags(args, ["--json"], ["--class"]);
	const requested = flags?.values.get("--class");
	const parsed =
		requested === undefined ? undefined : parseDataClass(requested);
	if (flags === null || parsed === null) {
		ports.stderr(USAGE);
		return 64;
	}
	const current = deviceStatus(ports.link.store);
	const dataClass =
		parsed ??
		(current.kind === "enrolled" || current.kind === "revoked"
			? current.dataClass
			: "metadata");
	const report = privacyReport(dataClass);
	ports.stdout(
		flags.bools.has("--json")
			? `${JSON.stringify(report, null, 2)}\n`
			: renderPrivacy(report),
	);
	return 0;
}

/** One `maina cloud <args>` invocation; resolves to the exit code. */
export async function runCloud(
	args: readonly string[],
	ports: CloudPorts,
): Promise<number> {
	const [command, ...rest] = args;
	switch (command) {
		case undefined:
		case "help":
		case "--help":
		case "-h":
			ports.stdout(USAGE);
			return 0;
		case "enrol":
		case "enroll":
			return enrol(rest, ports);
		case "status":
			return status(rest, ports);
		case "logout":
		case "unenrol":
			return logout(rest, ports);
		case "privacy":
			return privacy(rest, ports);
		default:
			ports.stderr(USAGE);
			return 64;
	}
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function deviceOs(platform: string): string {
	switch (platform) {
		case "darwin":
		case "linux":
			return platform;
		case "win32":
			return "windows";
		default:
			return "other";
	}
}

/** The real ports: `fetch`, `~/.maina/link` (or MAINA_LINK_DIR), node:crypto. */
function systemCloudPorts(): CloudPorts {
	return {
		link: {
			http: fetchHttp,
			store: fileLinkStore(linkDir(processEnv, homedir())),
			crypto: nodeLinkCrypto,
			clock: () => new Date(),
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		},
		env: processEnv,
		device: {
			os: deviceOs(process.platform),
			arch: process.arch,
			runtimeVersion: VERSION,
		},
		stdout: (text) => process.stdout.write(text),
		stderr: (text) => process.stderr.write(text),
	};
}

export function cloudCommand(): Command {
	return new Command("cloud")
		.description(
			"Maina Link: enrol this device with Maina Cloud, show its status, forget it, show what is sent",
		)
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.usage(
			"enrol [--ci] | status [--json] [--check] | logout | privacy [--class <class>] [--json]",
		)
		.action(async (_args: string[], _opts: unknown, cmd: Command) => {
			process.exitCode = await runCloud(cmd.args, systemCloudPorts());
		});
}
