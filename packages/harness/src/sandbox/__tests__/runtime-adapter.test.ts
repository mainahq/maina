/**
 * The sandbox-runtime adapter over a fake machine: the command
 * and settings a wrap produces, what it refuses, disposal and the decision
 * parser. The cases against a real srt are in
 * runtime-adapter.integration.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Result } from "@mainahq/core";
import { shallowTmpDir } from "../../__tests__/test-tmp";
import type { Command, SandboxError, SandboxOptions } from "../port";
import {
	createSandboxRuntime,
	parseSandboxDecisions,
	SANDBOX_RUNTIME,
	type SandboxRuntimeProbe,
} from "../runtime-adapter";
import { TMP_MARKER } from "../tmp-root";

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
			return { ok: true, value: `/tmp/maina-srt-x/settings.json` };
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
			"/tmp/maina-srt-x/settings.json",
			"--",
			"/opt/bin/codex-acp",
			"--flag",
		]);
	});

	test("the real credential is in srt's environment, beside the launch's own", () => {
		expect(wrapped().command.env).toEqual({
			INITIAL_AGENT_MODE: "agent-full-access",
			OPENAI_API_KEY: "sk-real-316",
			TMPDIR: "/tmp/maina-srt-x",
		});
	});

	test("srt's own temp files (its CA, sockets) go in the wrap's dir (#632)", () => {
		const { env } = wrapped().command;
		expect(env?.TMPDIR).toBe("/tmp/maina-srt-x");
		// Not TMP or TEMP: those pass through to the worker.
		expect(env?.TMP).toBeUndefined();
		expect(env?.TEMP).toBeUndefined();
	});

	test("a wrap dir too deep for srt's sockets is not srt's TMPDIR", () => {
		const deep = `/${"d".repeat(80)}/maina-srt-x/settings.json`;
		const { command } = wrapped({
			writeSettings: () => ({ ok: true, value: deep }),
		});
		expect(command.env?.TMPDIR).toBeUndefined();
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

describe("dispose: the settings temp dirs (#544)", () => {
	test("removes every settings file this port wrote, once", () => {
		const removed: string[] = [];
		let n = 0;
		const { port } = fakeRuntime({
			writeSettings: () => ({
				ok: true,
				value: `/tmp/maina-srt-${++n}/settings.json`,
			}),
			removeSettings: (path) => {
				removed.push(path);
			},
		});
		expect(port.wrap(AGENT, OPTIONS).ok).toBe(true);
		expect(port.wrap(AGENT, OPTIONS).ok).toBe(true);
		expect(removed).toEqual([]);
		port.dispose();
		expect(removed).toEqual([
			"/tmp/maina-srt-1/settings.json",
			"/tmp/maina-srt-2/settings.json",
		]);
		port.dispose();
		expect(removed).toHaveLength(2);
	});

	test("the real writer's maina-srt-* dir is gone after dispose", () => {
		const port = createSandboxRuntime({
			probe: ALL_INSTALLED,
			platform: "darwin",
			env: {},
		});
		const result = port.wrap(AGENT, { ...OPTIONS, credentials: [] });
		if (!result.ok) throw new Error(result.error.message);
		const args = result.value.args ?? [];
		const settings = String(args[args.indexOf("--settings") + 1]);
		const dir = dirname(settings);
		expect(basename(dir).startsWith("maina-srt-")).toBe(true);
		expect(existsSync(settings)).toBe(true);
		expect(existsSync(join(dir, TMP_MARKER))).toBe(true);
		expect(result.value.env?.TMPDIR).toBe(dir);
		port.dispose();
		expect(existsSync(dir)).toBe(false);
	});

	test("a port nobody disposed leaves nothing once its process exits (#632)", async () => {
		const parent = shallowTmpDir();
		const before = readdirSync(parent);
		const script = `
			import { createSandboxRuntime } from ${JSON.stringify(join(import.meta.dir, "..", "runtime-adapter.ts"))};
			const port = createSandboxRuntime({
				probe: { which: (b) => "/opt/bin/" + b, version: () => ${JSON.stringify(SANDBOX_RUNTIME.version)} },
				platform: "darwin",
				env: {},
			});
			const wrapped = port.wrap(
				{ name: "sh", command: "/bin/sh" },
				{ writeAllow: [], readDeny: [], netAllow: [], credentials: [] },
			);
			if (!wrapped.ok) process.exit(2);
			const srtTmp = wrapped.value.env.TMPDIR;
			if (!srtTmp?.startsWith(${JSON.stringify(parent)})) process.exit(3);
			await Bun.write(srtTmp + "/srt-ca-leak/ca.key", "k");
		`;
		const child = Bun.spawn(["bun", "-e", script], {
			env: { ...process.env, TMPDIR: parent },
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await child.exited).toBe(0);
		expect(readdirSync(parent)).toEqual(before);
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
