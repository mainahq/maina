/**
 * The sandbox port over Anthropic's sandbox-runtime (`srt`, Apache-2.0):
 * Seatbelt on macOS, bubblewrap plus a seccomp filter on Linux, and a
 * host-side proxy that enforces the network allowlist and swaps masked
 * credentials in on egress (ADR 0048).
 *
 * `srt` is a research preview whose settings format still moves, so the
 * adapter is pinned to one tested release (`SANDBOX_RUNTIME.version`) and
 * refuses any other; nothing outside this file knows `srt` exists.
 *
 * `wrap` writes the worker's settings to a private temp file (paths and
 * variable names only: no secret is ever written) and returns
 * `srt --debug --settings <file> -- <command>`. The real credential values
 * travel in srt's own environment; `srt` hands the worker a stand-in.
 * `--debug` makes srt log each network decision to stderr, which
 * `decisions` reads back.
 */

import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Result } from "@mainahq/core";
import { type CredentialPlan, planCredentials } from "./credential-proxy";
import type {
	SandboxDecision,
	SandboxError,
	SandboxOptions,
	SandboxPort,
} from "./port";

/** The one sandbox-runtime release this adapter is tested against. */
export const SANDBOX_RUNTIME = {
	package: "@anthropic-ai/sandbox-runtime",
	version: "0.0.77",
	binary: "srt",
} as const;

const INSTALL = `npm install -g ${SANDBOX_RUNTIME.package}@${SANDBOX_RUNTIME.version}`;

/** What srt needs on Linux beyond itself. */
const LINUX_TOOLS = ["bwrap", "socat"] as const;
const LINUX_INSTALL = "sudo apt-get install -y bubblewrap socat ripgrep";

const SUPPORTED_PLATFORMS: readonly string[] = ["darwin", "linux"];

/**
 * Read from srt's own environment: the TMPDIR it gives the sandboxed
 * process. Unset, every worker shares `/tmp/claude`.
 */
const SRT_TMPDIR = "CLAUDE_CODE_TMPDIR";

/** The adapter's view of the machine. */
export type SandboxRuntimeProbe = Readonly<{
	/** The absolute path of `binary` on PATH, or null. */
	which: (binary: string) => string | null;
	/** The version of the sandbox-runtime package `path` belongs to, or null. */
	version: (path: string) => string | null;
}>;

export type SandboxRuntimeDeps = Readonly<{
	probe: SandboxRuntimeProbe;
	platform: string;
	/** The environment srt will inherit (the harness's own). */
	env: Readonly<Record<string, string | undefined>>;
	/** Writes the settings JSON somewhere private and returns its path. */
	writeSettings: (json: string) => Result<string, SandboxError>;
}>;

/**
 * `srt --version` prints a hard-coded 1.0.0, so the version is read from
 * the package the binary belongs to: npm links `srt` to `dist/cli.js`.
 */
function packageVersion(path: string): string | null {
	try {
		const pkg = JSON.parse(
			readFileSync(
				join(dirname(dirname(realpathSync(path))), "package.json"),
				"utf8",
			),
		) as { name?: unknown; version?: unknown };
		return pkg.name === SANDBOX_RUNTIME.package &&
			typeof pkg.version === "string"
			? pkg.version
			: null;
	} catch {
		return null;
	}
}

const systemProbe: SandboxRuntimeProbe = {
	which: (binary) => Bun.which(binary),
	version: packageVersion,
};

export type DetectedRuntime = Readonly<{ path: string; version: string }>;

/** Finds the pinned `srt` (and, on Linux, what it needs) on this machine. */
export function detectSandboxRuntime(
	probe: SandboxRuntimeProbe = systemProbe,
	platform: string = process.platform,
): Result<DetectedRuntime, SandboxError> {
	if (!SUPPORTED_PLATFORMS.includes(platform)) {
		return {
			ok: false,
			error: {
				code: "unsupported_platform",
				message: `no OS sandbox for ${platform}: workers run only on macOS and Linux`,
			},
		};
	}
	const path = probe.which(SANDBOX_RUNTIME.binary);
	if (path === null) {
		return {
			ok: false,
			error: {
				code: "not_installed",
				message: `${SANDBOX_RUNTIME.binary} (${SANDBOX_RUNTIME.package}) is not on PATH`,
				hint: INSTALL,
			},
		};
	}
	const version = probe.version(path);
	if (version !== SANDBOX_RUNTIME.version) {
		return {
			ok: false,
			error: {
				code: "unsupported_version",
				message: `${SANDBOX_RUNTIME.package} ${version ?? "(unknown version)"} at ${path} is not the tested ${SANDBOX_RUNTIME.version}`,
				hint: INSTALL,
			},
		};
	}
	if (platform === "linux") {
		const missing = LINUX_TOOLS.filter((tool) => probe.which(tool) === null);
		if (missing.length > 0) {
			return {
				ok: false,
				error: {
					code: "not_installed",
					message: `the Linux sandbox needs ${missing.join(" and ")} on PATH`,
					hint: LINUX_INSTALL,
				},
			};
		}
	}
	return { ok: true, value: { path, version } };
}

/** The settings file srt reads: paths, host patterns and variable names only. */
function toSettings(
	options: SandboxOptions,
	plan: CredentialPlan,
): Readonly<Record<string, unknown>> {
	const masks = plan.envVars.some((rule) => rule.mode === "mask");
	const tmp = options.tmpDir === undefined ? [] : [options.tmpDir];
	return {
		network: {
			allowedDomains: [...new Set([...options.netAllow, ...plan.hosts])],
			deniedDomains: [...(options.netDeny ?? [])],
			// Deny what is not listed; never fall through to a prompt.
			strictAllowlist: true,
			allowLocalBinding: false,
			// A masked credential is swapped in on the decrypted request.
			...(masks ? { tlsTerminate: {} } : {}),
		},
		filesystem: {
			allowWrite: [...new Set([...options.writeAllow, ...tmp])],
			denyWrite: [...(options.writeDeny ?? [])],
			denyRead: [...options.readDeny],
			allowRead: [...new Set([...(options.readAllow ?? []), ...tmp])],
		},
		...(plan.envVars.length > 0
			? { credentials: { envVars: plan.envVars } }
			: {}),
		// Weakens Linux isolation to run inside unprivileged containers.
		enableWeakerNestedSandbox: false,
	};
}

/** A 0700 temp directory holding a 0600 settings file. */
function writeSettingsFile(json: string): Result<string, SandboxError> {
	try {
		const dir = mkdtempSync(join(tmpdir(), "maina-sandbox-"));
		chmodSync(dir, 0o700);
		const path = join(dir, "settings.json");
		writeFileSync(path, json, { mode: 0o600 });
		return { ok: true, value: path };
	} catch (e) {
		return {
			ok: false,
			error: {
				code: "io",
				message: `could not write the sandbox settings: ${e instanceof Error ? e.message : String(e)}`,
			},
		};
	}
}

/** srt's `--debug` lines for a network decision, and what each means. */
const DECISION_LINES: readonly (readonly [
	RegExp,
	SandboxDecision["verdict"],
	SandboxDecision["reason"],
])[] = [
	[/^Allowed by config rule: (.+):(\d+)$/, "allow", "allowlist"],
	[/^Denied by config rule: (.+):(\d+)$/, "deny", "denylist"],
	[/^No matching config rule, denying: (.+):(\d+)$/, "deny", "not_allowlisted"],
	[/^Denying malformed host: (.+):(\d+)$/, "deny", "malformed_host"],
];

const DEBUG_PREFIX = "[SandboxDebug] ";

/**
 * The network decisions in a wrapped process's stderr. srt logs one line
 * per connection it judges; the worker shares that stderr, so a line it
 * forges can add a decision that never happened but cannot hide or undo
 * one srt enforced.
 */
export function parseSandboxDecisions(stderr: string): SandboxDecision[] {
	return stderr.split(/\r?\n/).flatMap((line): SandboxDecision[] => {
		if (!line.startsWith(DEBUG_PREFIX)) return [];
		const message = line.slice(DEBUG_PREFIX.length);
		for (const [pattern, verdict, reason] of DECISION_LINES) {
			const match = pattern.exec(message);
			if (match?.[1] !== undefined && match[2] !== undefined) {
				return [
					{
						kind: "network",
						host: match[1],
						port: Number(match[2]),
						verdict,
						reason,
					},
				];
			}
		}
		return [];
	});
}

export function createSandboxRuntime(
	deps: Partial<SandboxRuntimeDeps> = {},
): SandboxPort {
	const probe = deps.probe ?? systemProbe;
	const platform = deps.platform ?? process.platform;
	const env = deps.env ?? Bun.env;
	const writeSettings = deps.writeSettings ?? writeSettingsFile;

	const wrap: SandboxPort["wrap"] = (command, options) => {
		const runtime = detectSandboxRuntime(probe, platform);
		if (!runtime.ok) return runtime;
		const launchEnv = command.env ?? {};
		const plan = planCredentials(options.credentials, env, launchEnv);
		if (!plan.ok) return plan;
		const settings = writeSettings(
			JSON.stringify(toSettings(options, plan.value), null, 2),
		);
		if (!settings.ok) return settings;
		return {
			ok: true,
			value: {
				name: command.name,
				command: runtime.value.path,
				args: [
					"--debug",
					"--settings",
					settings.value,
					"--",
					command.command,
					...(command.args ?? []),
				],
				env: {
					...launchEnv,
					...plan.value.hostEnv,
					// srt hands the worker this as TMPDIR, instead of /tmp/claude.
					...(options.tmpDir === undefined
						? {}
						: { [SRT_TMPDIR]: options.tmpDir }),
				},
			},
		};
	};

	return { wrap, decisions: parseSandboxDecisions };
}
