/**
 * Launcher tests (v1 task 2.3, FR-INS-1, FR-INS-2, FR-INS-7; ADR 0045).
 *
 * The launcher is what a host plugin spawns: `launch mcp`, `launch hook
 * <event>` or `launch cli ...`. It runs the cached runtime for the pinned
 * version, and otherwise downloads the artifact, checks its sha256 and
 * signature, caches it and runs it. When that one self-heal fails, hook mode
 * prints the host's fail-closed output and MCP mode serves a rules-only
 * status notice.
 *
 * Every case runs with `PATH=/usr/bin:/bin`, the PATH a GUI-launched host
 * passes on macOS, against a local artifact server. `launch.sh` runs on
 * macOS and Linux; `launch.ps1` runs where PowerShell is installed (set
 * `MAINA_TEST_PWSH` to a pwsh binary to force it).
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { failClosedHookOutput } from "../../src/standalone/hook-fallback";
import {
	createReleaseKey,
	currentTarget,
	fakeRuntime,
	launcherEnv,
	offlineUrl,
	runLauncher,
	type Staged,
	stageLauncher,
	startArtifactServer,
	TEST_VERSION,
} from "./fixture";

// PowerShell takes ~0.5 s to start, and some cases launch several times.
setDefaultTimeout(30_000);

const FAKE_RUNTIME = await fakeRuntime();
const key = createReleaseKey();
const otherKey = createReleaseKey();
const target = currentTarget();
const ARTIFACT_PATH = `/runtime/${TEST_VERSION}/maina-${target}`;

const cleanup: string[] = [];
afterAll(() => {
	for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function track(staged: Staged): Staged {
	cleanup.push(dirname(staged.dir));
	return staged;
}

type Interpreter = Readonly<{
	name: string;
	available: boolean;
	command: (staged: Staged) => readonly string[];
}>;

const pwsh = process.env.MAINA_TEST_PWSH ?? Bun.which("pwsh");

const INTERPRETERS: readonly Interpreter[] = [
	{
		name: "launch.sh",
		available: process.platform !== "win32",
		command: (s) => ["/bin/sh", join(s.dir, "launch.sh")],
	},
	{
		name: "launch.ps1",
		available: typeof pwsh === "string" && pwsh.length > 0,
		command: (s) => [
			pwsh ?? "pwsh",
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-File",
			join(s.dir, "launch.ps1"),
		],
	},
];

type RpcLine = Readonly<{
	id?: unknown;
	result?: Record<string, unknown>;
	error?: { code?: number; message?: string };
}>;

function rpcLines(stdout: string): readonly RpcLine[] {
	return stdout
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((l) => JSON.parse(l) as RpcLine);
}

const rpc = (msg: Record<string, unknown>): string =>
	`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`;

const INITIALIZE = rpc({
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "launcher-test", version: "0" },
	},
});

/** Time from spawn to the first line of the MCP `initialize` response. */
async function coldMcpStartMs(command: readonly string[], staged: Staged) {
	const t0 = performance.now();
	const proc = Bun.spawn([...command, "mcp"], {
		cwd: staged.home,
		env: launcherEnv(staged),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	proc.stdin.write(INITIALIZE);
	proc.stdin.flush();
	const reader = proc.stdout.getReader();
	let text = "";
	while (!text.includes("\n")) {
		const { value, done } = await reader.read();
		if (done) break;
		text += new TextDecoder().decode(value);
	}
	const ms = performance.now() - t0;
	proc.kill();
	await proc.exited;
	return { ms, first: text.split("\n")[0] ?? "" };
}

for (const interp of INTERPRETERS) {
	describe.skipIf(!interp.available)(interp.name, () => {
		test("first run downloads, verifies, caches and runs the artifact", async () => {
			const server = startArtifactServer({ [ARTIFACT_PATH]: FAKE_RUNTIME });
			try {
				const staged = track(
					stageLauncher({
						target,
						pinned: FAKE_RUNTIME,
						url: `${server.url}${ARTIFACT_PATH}`,
						key,
					}),
				);
				const first = await runLauncher(["cli", "--version", "two words"], {
					command: interp.command(staged),
					staged,
				});
				expect(first.stderr).toBe("");
				expect(first.exitCode).toBe(0);
				expect(first.stdout.trim()).toBe(
					"fake-runtime cli --version two words",
				);
				expect(server.requests).toEqual([ARTIFACT_PATH]);
				expect(readFileSync(staged.cached)).toEqual(Buffer.from(FAKE_RUNTIME));

				const hook = await runLauncher(["hook", "PreToolUse"], {
					command: interp.command(staged),
					staged,
				});
				expect(hook.stdout.trim()).toBe("fake-runtime hook PreToolUse");
				// The cached runtime is reused: no second download.
				expect(server.requests).toEqual([ARTIFACT_PATH]);
			} finally {
				server.stop();
			}
		});

		test("rejects a tampered artifact whose checksum does not match", async () => {
			const tampered = new TextEncoder().encode(
				"#!/bin/sh\necho pwned > /tmp/maina-launcher-pwned\n",
			);
			const server = startArtifactServer({ [ARTIFACT_PATH]: tampered });
			try {
				const staged = track(
					stageLauncher({
						target,
						pinned: FAKE_RUNTIME,
						url: `${server.url}${ARTIFACT_PATH}`,
						key,
					}),
				);
				const out = await runLauncher(["hook", "PreToolUse"], {
					command: interp.command(staged),
					staged,
				});
				expect(out.exitCode).toBe(0);
				expect(out.stdout.trim()).toBe(
					failClosedHookOutput("PreToolUse", "checksum_mismatch"),
				);
				expect(out.stderr).toContain("checksum_mismatch");
				expect(existsSync(staged.cached)).toBe(false);
				expect(existsSync(dirname(staged.cached))).toBe(true);
			} finally {
				server.stop();
			}
		});

		test("rejects an artifact whose signature the pinned key does not verify", async () => {
			const server = startArtifactServer({ [ARTIFACT_PATH]: FAKE_RUNTIME });
			try {
				// Checksum matches, but the manifest was signed with another key.
				const staged = track(
					stageLauncher({
						target,
						pinned: FAKE_RUNTIME,
						url: `${server.url}${ARTIFACT_PATH}`,
						key,
						signingKey: otherKey,
					}),
				);
				const out = await runLauncher(["hook", "PreToolUse"], {
					command: interp.command(staged),
					staged,
				});
				expect(out.exitCode).toBe(0);
				expect(out.stdout.trim()).toBe(
					failClosedHookOutput("PreToolUse", "bad_signature"),
				);
				expect(existsSync(staged.cached)).toBe(false);
			} finally {
				server.stop();
			}
		});

		test("refuses to install anything without a pinned release key", async () => {
			const server = startArtifactServer({ [ARTIFACT_PATH]: FAKE_RUNTIME });
			try {
				const staged = track(
					stageLauncher({
						target,
						pinned: FAKE_RUNTIME,
						url: `${server.url}${ARTIFACT_PATH}`,
						key,
						withoutKey: true,
					}),
				);
				const out = await runLauncher(["hook", "PreToolUse"], {
					command: interp.command(staged),
					staged,
				});
				expect(out.stdout.trim()).toBe(
					failClosedHookOutput("PreToolUse", "no_release_key"),
				);
				expect(server.requests).toEqual([]);
				expect(existsSync(staged.cached)).toBe(false);
			} finally {
				server.stop();
			}
		});

		test.skipIf(interp.name !== "launch.sh")(
			"the runtime inherits the host's umask, not the launcher's",
			async () => {
				const server = startArtifactServer({ [ARTIFACT_PATH]: FAKE_RUNTIME });
				try {
					const staged = track(
						stageLauncher({
							target,
							pinned: FAKE_RUNTIME,
							url: `${server.url}${ARTIFACT_PATH}`,
							key,
						}),
					);
					const expected = process.umask().toString(8).padStart(4, "0");
					for (let run = 0; run < 2; run++) {
						// First run installs, second runs from the cache.
						const out = await runLauncher(["cli", "umask"], {
							command: interp.command(staged),
							staged,
						});
						expect(out.stdout.trim()).toBe(expected);
					}
				} finally {
					server.stop();
				}
			},
		);

		test("offline with a cached runtime runs it", async () => {
			const server = startArtifactServer({ [ARTIFACT_PATH]: FAKE_RUNTIME });
			const staged = track(
				stageLauncher({
					target,
					pinned: FAKE_RUNTIME,
					url: `${server.url}${ARTIFACT_PATH}`,
					key,
				}),
			);
			await runLauncher(["cli", "warm"], {
				command: interp.command(staged),
				staged,
			});
			server.stop();
			expect(existsSync(staged.cached)).toBe(true);

			const out = await runLauncher(["mcp"], {
				command: interp.command(staged),
				staged,
				stdin: INITIALIZE,
			});
			expect(out.exitCode).toBe(0);
			const [init] = rpcLines(out.stdout);
			expect(init?.result?.serverInfo).toEqual({
				name: "fake-runtime",
				version: "0",
			});
		});

		describe("offline with no cache", () => {
			const stageOffline = (): Staged =>
				track(
					stageLauncher({
						target,
						pinned: FAKE_RUNTIME,
						url: `${offlineUrl()}${ARTIFACT_PATH}`,
						key,
					}),
				);

			const EVENTS = [
				"PreToolUse",
				"PermissionRequest",
				"PostToolUse",
				"SessionStart",
				"Stop",
				"beforeShellExecution",
				"beforeMCPExecution",
				"preToolUse",
				"postToolUse",
				"sessionStart",
				"stop",
			] as const;

			test("hook mode prints the host's fail-closed output for every event", async () => {
				const staged = stageOffline();
				for (const event of EVENTS) {
					const out = await runLauncher(["hook", event], {
						command: interp.command(staged),
						staged,
					});
					expect(out.exitCode).toBe(0);
					expect(out.stdout.trim()).toBe(
						failClosedHookOutput(event, "download_failed"),
					);
				}
				expect(existsSync(staged.cached)).toBe(false);
				// One launch per event; PowerShell on Windows takes ~3 s each.
			}, 120_000);

			test("hook mode never allows: pre-tool events ask", async () => {
				const staged = stageOffline();
				const claude = await runLauncher(["hook", "PreToolUse"], {
					command: interp.command(staged),
					staged,
				});
				expect(JSON.parse(claude.stdout)).toMatchObject({
					hookSpecificOutput: {
						hookEventName: "PreToolUse",
						permissionDecision: "ask",
					},
				});
				const cursor = await runLauncher(["hook", "beforeShellExecution"], {
					command: interp.command(staged),
					staged,
				});
				expect(JSON.parse(cursor.stdout)).toMatchObject({ permission: "ask" });
			});

			test("MCP mode starts rules-only with a status notice", async () => {
				const staged = stageOffline();
				const out = await runLauncher(["mcp"], {
					command: interp.command(staged),
					staged,
					stdin: [
						INITIALIZE,
						rpc({ method: "notifications/initialized" }),
						rpc({ id: 2, method: "tools/list", params: {} }),
						rpc({
							id: "three",
							method: "tools/call",
							params: { name: "status", arguments: {} },
						}),
						rpc({ id: 4, method: "tools/call", params: { name: "verify" } }),
						rpc({ id: 5, method: "resources/read", params: {} }),
						rpc({ id: 6, method: "ping" }),
					].join(""),
				});
				expect(out.exitCode).toBe(0);
				expect(out.stderr).toContain("download_failed");
				const lines = rpcLines(out.stdout);
				expect(lines.map((l) => l.id)).toEqual([1, 2, "three", 4, 5, 6]);

				const [init, list, status, verify, unknown, ping] = lines;
				expect(init?.result?.protocolVersion).toBe("2025-06-18");
				expect(init?.result?.serverInfo).toEqual({
					name: "maina",
					version: TEST_VERSION,
				});
				expect(String(init?.result?.instructions)).toContain("rules-only");
				expect(String(init?.result?.instructions)).toContain("download_failed");

				const tools = list?.result?.tools as { name: string }[];
				expect(tools.map((t) => t.name)).toEqual(["status"]);

				const content = status?.result?.content as { text: string }[];
				expect(status?.result?.isError).toBe(false);
				expect(content[0]?.text).toContain("rules-only");

				expect(verify?.result?.isError).toBe(true);
				expect(unknown?.error?.code).toBe(-32601);
				expect(ping?.result).toEqual({});
			});

			test("rules-only MCP reads the top-level id, method and params, not nested ones", async () => {
				const staged = stageOffline();
				// The MCP SDK serializes `{ ...request, jsonrpc, id }`: the
				// top-level id comes after params, which may carry their own
				// `id`, `method` or `name` keys.
				const raw = (text: string): string => `${text}\n`;
				const out = await runLauncher(["mcp"], {
					command: interp.command(staged),
					staged,
					stdin: [
						raw(
							'{"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"x":{"id":99}},"clientInfo":{"name":"c","version":"1"}},"jsonrpc":"2.0","id":0}',
						),
						raw(
							'{"method":"tools/call","params":{"name":"status","arguments":{"id":7}},"jsonrpc":"2.0","id":3}',
						),
						raw(
							'{"params":{"arguments":{"name":"status","method":"ping"},"name":"verify"},"method":"tools/call","jsonrpc":"2.0","id":"a\\"b"}',
						),
						raw(
							'{"method":"notifications/cancelled","params":{"requestId":3,"id":5},"jsonrpc":"2.0"}',
						),
					].join(""),
				});
				expect(out.exitCode).toBe(0);
				const lines = rpcLines(out.stdout);
				expect(lines.map((l) => l.id)).toEqual([0, 3, 'a"b']);
				const [init, status, verify] = lines;
				expect(init?.result?.protocolVersion).toBe("2025-06-18");
				expect(status?.result?.isError).toBe(false);
				expect(verify?.result?.isError).toBe(true);
			});

			test("CLI mode exits non-zero with the reason", async () => {
				const staged = stageOffline();
				const out = await runLauncher(["cli", "verify"], {
					command: interp.command(staged),
					staged,
				});
				expect(out.exitCode).toBe(69);
				expect(out.stdout).toBe("");
				expect(out.stderr).toContain("download_failed");
			});
		});

		describe("without a usable manifest", () => {
			const stageBroken = (manifest: string | null): Staged => {
				const staged = track(
					stageLauncher({
						target,
						pinned: FAKE_RUNTIME,
						url: `${offlineUrl()}${ARTIFACT_PATH}`,
						key,
					}),
				);
				const path = join(staged.dir, "manifest.json");
				if (manifest === null) rmSync(path);
				else writeFileSync(path, manifest);
				return staged;
			};

			for (const [cause, manifest] of [
				["no_manifest", null],
				[
					"bad_manifest",
					'{\n  "schema": 1,\n  "version": "1.0 beta",\n  "artifacts": {}\n}\n',
				],
			] as const) {
				test(`${cause}: MCP mode still serves rules-only`, async () => {
					const staged = stageBroken(manifest);
					const out = await runLauncher(["mcp"], {
						command: interp.command(staged),
						staged,
						stdin: [INITIALIZE, rpc({ id: 2, method: "ping" })].join(""),
					});
					expect(out.exitCode).toBe(0);
					expect(out.stderr).toContain(cause);
					const [init, ping] = rpcLines(out.stdout);
					expect(init?.id).toBe(1);
					expect(init?.result?.serverInfo).toEqual({
						name: "maina",
						version: "",
					});
					expect(String(init?.result?.instructions)).toContain(cause);
					expect(ping?.result).toEqual({});
				});

				test(`${cause}: hook mode fails closed`, async () => {
					const staged = stageBroken(manifest);
					const out = await runLauncher(["hook", "PreToolUse"], {
						command: interp.command(staged),
						staged,
					});
					expect(out.exitCode).toBe(0);
					expect(out.stdout.trim()).toBe(
						failClosedHookOutput("PreToolUse", cause),
					);
				});
			}
		});

		test("cold MCP start from cache is at most 1.5 s", async () => {
			const server = startArtifactServer({ [ARTIFACT_PATH]: FAKE_RUNTIME });
			const staged = track(
				stageLauncher({
					target,
					pinned: FAKE_RUNTIME,
					url: `${server.url}${ARTIFACT_PATH}`,
					key,
				}),
			);
			await runLauncher(["cli", "warm"], {
				command: interp.command(staged),
				staged,
			});
			server.stop();
			const { ms, first } = await coldMcpStartMs(
				interp.command(staged),
				staged,
			);
			expect(first).toContain('"fake-runtime"');
			expect(ms).toBeLessThanOrEqual(1_500);
		});

		test("an unknown mode prints usage and exits 64", async () => {
			const staged = track(
				stageLauncher({
					target,
					pinned: FAKE_RUNTIME,
					url: `${offlineUrl()}${ARTIFACT_PATH}`,
					key,
				}),
			);
			const out = await runLauncher(["serve"], {
				command: interp.command(staged),
				staged,
			});
			expect(out.exitCode).toBe(64);
			expect(out.stderr).toContain("usage");
		});
	});
}
