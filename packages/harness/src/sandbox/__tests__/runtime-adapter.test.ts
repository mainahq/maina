import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, type Result } from "@mainahq/core";
import { policyToSandbox } from "../policy-to-sandbox";
import type { Command, SandboxError, SandboxOptions } from "../port";
import {
	createSandboxRuntime,
	detectSandboxRuntime,
	parseSandboxDecisions,
	SANDBOX_RUNTIME,
	type SandboxRuntimeProbe,
} from "../runtime-adapter";
import {
	integrationTitle,
	type Layout,
	makeLayout,
	REQUIRE_SANDBOX,
	run,
	SKIP_REASON,
	shell,
} from "./sandbox-fixture";

// ── Unit: the wrapped command, with a fake machine ──────────────────────────

const SRT = "/opt/bin/srt";

function fakeProbe(
	installed: Readonly<Record<string, string | null>>,
): SandboxRuntimeProbe {
	return {
		which: (binary) => (binary in installed ? `/opt/bin/${binary}` : null),
		version: (path) => installed[path.slice("/opt/bin/".length)] ?? null,
	};
}

const ALL_INSTALLED = fakeProbe({
	srt: SANDBOX_RUNTIME.version,
	bwrap: null,
	socat: null,
});

const AGENT: Command = {
	name: "codex",
	command: "/opt/bin/codex-acp",
	args: ["--flag"],
	env: { INITIAL_AGENT_MODE: "agent-full-access" },
};

const OPTIONS: SandboxOptions = {
	writeAllow: ["/work/wt/run-1"],
	readDeny: ["/home/dev/.ssh", "/work/wt"],
	readAllow: ["/work/wt/run-1"],
	netAllow: ["registry.npmjs.org"],
	credentials: [
		{
			name: "OPENAI_API_KEY",
			value: "sk-real-316",
			hosts: ["api.openai.com"],
		},
	],
};

function fakeRuntime(
	overrides: Partial<Parameters<typeof createSandboxRuntime>[0]> = {},
) {
	const written: string[] = [];
	const port = createSandboxRuntime({
		probe: ALL_INSTALLED,
		platform: "darwin",
		env: { PATH: "/usr/bin", GITHUB_TOKEN: "ghp_ambient_316" },
		writeSettings: (json): Result<string, SandboxError> => {
			written.push(json);
			return { ok: true, value: `/tmp/maina-sandbox-x/settings.json` };
		},
		...overrides,
	});
	return { port, written };
}

function wrapped(overrides?: Parameters<typeof fakeRuntime>[0]) {
	const { port, written } = fakeRuntime(overrides);
	const result = port.wrap(AGENT, OPTIONS);
	if (!result.ok) throw new Error(result.error.message);
	const settings = JSON.parse(written[0] ?? "{}");
	return { command: result.value, settings, raw: written[0] ?? "" };
}

describe("wrap: the command", () => {
	test("srt starts the agent, reading the settings maina wrote", () => {
		const { command } = wrapped();
		expect(command.name).toBe("codex");
		expect(command.command).toBe(SRT);
		expect(command.args).toEqual([
			"--debug",
			"--settings",
			"/tmp/maina-sandbox-x/settings.json",
			"--",
			"/opt/bin/codex-acp",
			"--flag",
		]);
	});

	test("the real credential is in srt's environment, beside the launch's own", () => {
		expect(wrapped().command.env).toEqual({
			INITIAL_AGENT_MODE: "agent-full-access",
			OPENAI_API_KEY: "sk-real-316",
		});
	});

	test("a worker temp dir replaces srt's shared /tmp/claude and is writable", () => {
		const { port, written } = fakeRuntime();
		const result = port.wrap(AGENT, { ...OPTIONS, tmpDir: "/tmp/run-1" });
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.env?.CLAUDE_CODE_TMPDIR).toBe("/tmp/run-1");
		const settings = JSON.parse(written[0] ?? "{}");
		expect(settings.filesystem.allowWrite).toContain("/tmp/run-1");
		expect(settings.filesystem.allowRead).toContain("/tmp/run-1");
	});
});

describe("wrap: the settings", () => {
	test("filesystem rules are passed through as written", () => {
		expect(wrapped().settings.filesystem).toEqual({
			allowWrite: ["/work/wt/run-1"],
			denyWrite: [],
			denyRead: ["/home/dev/.ssh", "/work/wt"],
			allowRead: ["/work/wt/run-1"],
		});
	});

	test("the allowlist is strict and includes the credentials' hosts", () => {
		const { network } = wrapped().settings;
		expect(network.allowedDomains).toEqual([
			"registry.npmjs.org",
			"api.openai.com",
		]);
		expect(network.deniedDomains).toEqual([]);
		expect(network.strictAllowlist).toBe(true);
		expect(network.allowLocalBinding).toBe(false);
	});

	test("a masked credential turns on TLS termination so it can be swapped in", () => {
		expect(wrapped().settings.network.tlsTerminate).toEqual({});
	});

	test("the credential is masked and the ambient token withheld", () => {
		const { envVars } = wrapped().settings.credentials;
		expect(envVars).toContainEqual({
			name: "OPENAI_API_KEY",
			mode: "mask",
			injectHosts: ["api.openai.com"],
		});
		expect(envVars).toContainEqual({ name: "GITHUB_TOKEN", mode: "deny" });
	});

	test("no secret value is written to the settings file", () => {
		const { raw } = wrapped();
		expect(raw).not.toContain("sk-real-316");
		expect(raw).not.toContain("ghp_ambient_316");
	});

	test("the weaker nested mode stays off", () => {
		expect(wrapped().settings.enableWeakerNestedSandbox).toBe(false);
	});
});

describe("wrap: refuses to run unsandboxed", () => {
	test("srt missing: an install hint pinned to the tested version", () => {
		const { port } = fakeRuntime({ probe: fakeProbe({}) });
		const result = port.wrap(AGENT, OPTIONS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("not_installed");
		expect(result.error.hint).toBe(
			`npm install -g ${SANDBOX_RUNTIME.package}@${SANDBOX_RUNTIME.version}`,
		);
	});

	test("another srt version: the research preview's config may have moved", () => {
		const { port } = fakeRuntime({ probe: fakeProbe({ srt: "0.0.12" }) });
		const result = port.wrap(AGENT, OPTIONS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("unsupported_version");
		expect(result.error.message).toContain("0.0.12");
		expect(result.error.message).toContain(SANDBOX_RUNTIME.version);
	});

	test("Linux without bubblewrap or socat", () => {
		const { port } = fakeRuntime({
			platform: "linux",
			probe: fakeProbe({ srt: SANDBOX_RUNTIME.version, socat: null }),
		});
		const result = port.wrap(AGENT, OPTIONS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("not_installed");
		expect(result.error.message).toContain("bwrap");
	});

	test("Windows is not supported yet", () => {
		const { port } = fakeRuntime({ platform: "win32" });
		const result = port.wrap(AGENT, OPTIONS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("unsupported_platform");
	});

	test("a credential it cannot protect", () => {
		const { port, written } = fakeRuntime();
		const result = port.wrap(AGENT, {
			...OPTIONS,
			credentials: [{ name: "K", value: "v", hosts: [] }],
		});
		expect(result.ok).toBe(false);
		expect(written).toEqual([]);
	});

	test("a settings file it cannot write", () => {
		const { port } = fakeRuntime({
			writeSettings: () => ({
				ok: false,
				error: { code: "io", message: "disk full" },
			}),
		});
		const result = port.wrap(AGENT, OPTIONS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("io");
	});
});

describe("parseSandboxDecisions", () => {
	test("reads each network decision srt logged, in order", () => {
		const stderr = [
			"[SandboxDebug] Initializing sandbox...",
			"[SandboxDebug] Allowed by config rule: api.openai.com:443",
			"agent: some diagnostic of its own",
			"[SandboxDebug] No matching config rule, denying: example.com:443",
			"[SandboxDebug] Connection blocked to example.com:443",
			"[SandboxDebug] Denied by config rule: evil.example.com:80",
			'[SandboxDebug] Denying malformed host: "a\\u0000b":443',
		].join("\n");
		expect(parseSandboxDecisions(stderr)).toEqual([
			{
				kind: "network",
				host: "api.openai.com",
				port: 443,
				verdict: "allow",
				reason: "allowlist",
			},
			{
				kind: "network",
				host: "example.com",
				port: 443,
				verdict: "deny",
				reason: "not_allowlisted",
			},
			{
				kind: "network",
				host: "evil.example.com",
				port: 80,
				verdict: "deny",
				reason: "denylist",
			},
			{
				kind: "network",
				host: '"a\\u0000b"',
				port: 443,
				verdict: "deny",
				reason: "malformed_host",
			},
		]);
	});

	test("the port exposes the same parser", () => {
		const { port } = fakeRuntime();
		expect(
			port.decisions(
				"[SandboxDebug] No matching config rule, denying: x.io:22\n",
			),
		).toHaveLength(1);
	});
});

// ── Integration: a real srt on this machine ─────────────────────────────────

test.if(REQUIRE_SANDBOX && SKIP_REASON !== undefined)(
	"the sandbox runtime is installed (MAINA_REQUIRE_SANDBOX=1)",
	() => {
		throw new Error(`sandbox runtime unavailable: ${SKIP_REASON}`);
	},
);

function sandboxFor(layout: Layout, extra: Partial<SandboxOptions> = {}) {
	const base = policyToSandbox(
		DEFAULT_POLICY,
		layout.worktree,
		layout.holdout,
		{ home: layout.home, tmpDir: layout.tmp },
	);
	if (!base.ok) throw new Error(base.error.message);
	return { ...base.value, ...extra };
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? filesUnder(full) : [full];
	});
}

const INTEGRATION_MS = 30_000;

describe.skipIf(SKIP_REASON !== undefined)(
	integrationTitle("srt sandbox (integration)"),
	() => {
		test(
			"writes outside the worktree fail; writes inside succeed",
			async () => {
				const layout = makeLayout();
				const port = createSandboxRuntime();
				const outside = join(layout.outside, "escaped.txt");
				const inside = join(layout.worktree, "made.txt");
				const wrappedCmd = port.wrap(
					shell(`echo in > '${inside}'; echo out > '${outside}'`),
					sandboxFor(layout),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(existsSync(inside)).toBe(true);
				expect(existsSync(outside)).toBe(false);
				expect(ran.stderr).toMatch(/not permitted|denied|read-only/i);
			},
			INTEGRATION_MS,
		);

		test(
			"reads of ~/.ssh, other worktrees and the holdout directory fail",
			async () => {
				const layout = makeLayout();
				const port = createSandboxRuntime();
				const script = [
					`cat '${join(layout.home, ".ssh", "id_rsa")}'`,
					`cat '${join(layout.otherWorktree, "notes.txt")}'`,
					`cat '${join(layout.holdout, "answers.txt")}'`,
					`cat '${join(layout.worktree, "README.md")}'`,
				].join("; ");
				const wrappedCmd = port.wrap(shell(script), sandboxFor(layout));
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(ran.stdout).toContain("own worktree");
				expect(ran.stdout).not.toContain("PRIVATE-KEY-316");
				expect(ran.stdout).not.toContain("OTHER-RUN-316");
				expect(ran.stdout).not.toContain("HOLDOUT-316");
			},
			INTEGRATION_MS,
		);

		test(
			"a non-allowlisted host is blocked and logged as a decision",
			async () => {
				const layout = makeLayout();
				const port = createSandboxRuntime();
				const wrappedCmd = port.wrap(
					shell(
						"curl -sS -o /dev/null --max-time 10 https://not-allowlisted.example.com/; echo curl=$?",
					),
					sandboxFor(layout, { netAllow: ["allowed.example.com"] }),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(ran.stdout).not.toContain("curl=0");
				expect(port.decisions(ran.stderr)).toContainEqual({
					kind: "network",
					host: "not-allowlisted.example.com",
					port: 443,
					verdict: "deny",
					reason: "not_allowlisted",
				});
			},
			INTEGRATION_MS,
		);

		test(
			"the worker's temp files land in its own temp dir",
			async () => {
				const layout = makeLayout();
				const port = createSandboxRuntime();
				const wrappedCmd = port.wrap(
					shell('echo "$TMPDIR"; mktemp "$TMPDIR/maina.XXXXXX"'),
					sandboxFor(layout),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(ran.exitCode).toBe(0);
				const [tmpdirSeen, made] = ran.stdout.trim().split("\n");
				expect(tmpdirSeen).toBe(layout.tmp);
				expect(made?.startsWith(layout.tmp)).toBe(true);
			},
			INTEGRATION_MS,
		);

		test(
			"credentials never appear in the worker's env or files",
			async () => {
				const layout = makeLayout();
				const secret = "sk-real-credential-316";
				const ambient = "ghp_ambient_token_316";
				const env = { ...process.env, GITHUB_TOKEN: ambient };
				const port = createSandboxRuntime({ env });
				const dump = join(layout.worktree, "env.txt");
				const wrappedCmd = port.wrap(
					shell(`env > '${dump}'; env > '${join(layout.tmp, "env.txt")}'; env`),
					sandboxFor(layout, {
						credentials: [
							{
								name: "MAINA_TEST_API_KEY",
								value: secret,
								hosts: ["api.example.com"],
							},
						],
					}),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree, env);
				expect(ran.exitCode).toBe(0);
				// The worker sees the variable, holding a stand-in.
				expect(ran.stdout).toMatch(/^MAINA_TEST_API_KEY=.+$/m);
				const settingsPath =
					wrappedCmd.value.args?.[
						(wrappedCmd.value.args?.indexOf("--settings") ?? -2) + 1
					];
				const scanned = [
					ran.stdout,
					...filesUnder(layout.base).map((f) => readFileSync(f, "utf8")),
					readFileSync(String(settingsPath), "utf8"),
				];
				for (const text of scanned) {
					expect(text).not.toContain(secret);
					expect(text).not.toContain(ambient);
				}
			},
			INTEGRATION_MS,
		);
	},
);

// Keeps the detection honest on machines that do have srt: it resolves to
// the pinned package, not whatever `srt --version` claims (it prints 1.0.0).
test.skipIf(SKIP_REASON !== undefined)(
	integrationTitle("detectSandboxRuntime reads the installed package version"),
	() => {
		const found = detectSandboxRuntime();
		expect(found.ok).toBe(true);
		if (!found.ok) return;
		expect(found.value.version).toBe(SANDBOX_RUNTIME.version);
	},
);
