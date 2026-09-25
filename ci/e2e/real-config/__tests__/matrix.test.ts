/**
 * Real-config e2e matrix (v1 task 0.1, FR-INS-6).
 *
 * For every host × install path × env this test:
 *   1. runs the real installer inside a throwaway HOME + project,
 *   2. reads the MCP config from the location the HOST actually reads
 *      (not where the installer claims to have written it),
 *   3. spawns the exact launch command with a GUI-like environment,
 *   4. completes an MCP handshake and one `verify` tool call.
 *
 * Cases that are known to fail today are listed in `KNOWN_FAILURES`,
 * each with the problem it reproduces (P1–P4) and the issue that fixes
 * it. A known failure must fail *for that reason*; once the fix lands
 * the case starts passing, this test goes red, and the entry is removed.
 *
 * `MAINA_E2E_STRICT=1` ignores `KNOWN_FAILURES` so every case must start
 * (this is how the failures were first reproduced). `E2E_HOST`,
 * `E2E_INSTALL_PATH` and `E2E_ENV` narrow the matrix for CI cells.
 */

import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentOs, GUI_PATH, hostEnv, minimalEnv } from "../env";
import {
	type CaseError,
	checkSeeds,
	classifyProblem,
	createWorkspace,
	ENV_MODES,
	expectedFailure,
	HOSTS,
	INSTALL_PATHS,
	KNOWN_FAILURES,
	probeLaunch,
	problemsOf,
	resolveLaunch,
	runCase,
	seedsFor,
} from "../matrix";

// ── minimalEnv ─────────────────────────────────────────────────────────────

describe("minimalEnv", () => {
	test("darwin reproduces the launchd PATH GUI apps inherit", () => {
		expect(minimalEnv("darwin")).toEqual({
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
		});
	});

	test("linux reproduces the desktop-session PATH", () => {
		expect(minimalEnv("linux").PATH).toBe(GUI_PATH.linux);
	});

	test("never contains user-level toolchain directories", () => {
		for (const os of ["darwin", "linux"] as const) {
			const path = minimalEnv(os).PATH;
			expect(path).not.toContain(".bun");
			expect(path).not.toContain("homebrew");
			expect(path).not.toContain("node_modules");
		}
	});

	test("hostEnv(minimal) is PATH + HOME only", () => {
		const env = hostEnv("minimal", {
			os: "darwin",
			home: "/tmp/h",
			shellEnv: { PATH: "/tmp/h/.bun/bin:/usr/bin", SECRET: "x" },
		});
		expect(env).toEqual({ PATH: GUI_PATH.darwin, HOME: "/tmp/h" });
	});

	test("hostEnv(gui) keeps session vars but not the shell PATH", () => {
		const env = hostEnv("gui", {
			os: "darwin",
			home: "/tmp/h",
			shellEnv: {
				PATH: "/tmp/h/.bun/bin:/usr/bin",
				USER: "me",
				LANG: "en_US.UTF-8",
				OPENROUTER_API_KEY: "k",
			},
		});
		expect(env.PATH).toBe(GUI_PATH.darwin);
		expect(env.USER).toBe("me");
		expect(env.LANG).toBe("en_US.UTF-8");
		expect(env.HOME).toBe("/tmp/h");
		expect(env.OPENROUTER_API_KEY).toBeUndefined();
	});

	test("hostEnv(full) is the user's shell env with HOME pinned", () => {
		const env = hostEnv("full", {
			os: "linux",
			home: "/tmp/h",
			shellEnv: { PATH: "/tmp/h/.bun/bin:/usr/bin", HOME: "/real" },
		});
		expect(env).toEqual({ PATH: "/tmp/h/.bun/bin:/usr/bin", HOME: "/tmp/h" });
	});

	test("currentOs rejects unsupported platforms", () => {
		expect(currentOs("darwin")).toEqual({ ok: true, value: "darwin" });
		expect(currentOs("linux")).toEqual({ ok: true, value: "linux" });
		expect(currentOs("win32").ok).toBe(false);
	});
});

// ── Host config readers ────────────────────────────────────────────────────

function files(map: Record<string, string>): (p: string) => string | null {
	return (p) => map[p] ?? null;
}

const ctx = { home: "/h", cwd: "/p" };
const entry = (command: string) =>
	JSON.stringify({ mcpServers: { maina: { command, args: ["--mcp"] } } });

describe("resolveLaunch", () => {
	test("claude-code reads ~/.claude.json user scope", () => {
		const r = resolveLaunch(
			"claude-code",
			ctx,
			files({ "/h/.claude.json": entry("/bin/maina") }),
		);
		expect(r.ok && r.value.command).toBe("/bin/maina");
		expect(r.ok && r.value.source).toBe("/h/.claude.json");
	});

	test("claude-code local scope beats project .mcp.json beats user", () => {
		const r = resolveLaunch(
			"claude-code",
			ctx,
			files({
				"/h/.claude.json": JSON.stringify({
					mcpServers: { maina: { command: "user" } },
					projects: { "/p": { mcpServers: { maina: { command: "local" } } } },
				}),
				"/p/.mcp.json": entry("project"),
			}),
		);
		expect(r.ok && r.value.command).toBe("local");
	});

	test("claude-code never reads settings.json (P1)", () => {
		const r = resolveLaunch(
			"claude-code",
			ctx,
			files({
				"/h/.claude/settings.json": entry("/bin/maina"),
				"/p/.claude/settings.json": entry("/bin/maina"),
			}),
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.kind).toBe("config-not-found");
		if (r.error.kind !== "config-not-found") return;
		expect(r.error.strays).toContain("/h/.claude/settings.json");
		expect(r.error.strays).toContain("/p/.claude/settings.json");
		expect(classifyProblem(r.error)).toBe("P1");
	});

	test("cursor project config beats global", () => {
		const r = resolveLaunch(
			"cursor",
			ctx,
			files({
				"/h/.cursor/mcp.json": entry("global"),
				"/p/.cursor/mcp.json": entry("project"),
			}),
		);
		expect(r.ok && r.value.command).toBe("project");
	});

	test("codex reads [mcp_servers.maina] from ~/.codex/config.toml", () => {
		const r = resolveLaunch(
			"codex",
			ctx,
			files({
				"/h/.codex/config.toml":
					'model = "x"\n\n[mcp_servers.maina]\ncommand = "/bin/maina"\nargs = ["--mcp"]\n\n[mcp_servers.maina.env]\nFOO = "1"\n',
			}),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.command).toBe("/bin/maina");
		expect(r.value.args).toEqual(["--mcp"]);
		expect(r.value.env).toEqual({ FOO: "1" });
	});

	test("malformed config is reported, not skipped", () => {
		const r = resolveLaunch(
			"cursor",
			ctx,
			files({ "/h/.cursor/mcp.json": "{ nope" }),
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe("config-invalid");
	});
});

// ── MCP probe ──────────────────────────────────────────────────────────────

/**
 * A fake MCP server using the SDK's stdio framing (newline-delimited JSON,
 * see `@modelcontextprotocol/sdk` `shared/stdio.js`). It answers
 * `initialize` after `delayMs` (or rejects it when told to), then `verify`.
 */
const FAKE_SERVER = `
const delayMs = Number(process.argv[2]);
const mode = process.argv[3];
const reject = mode === "reject";
let buf = "";
const send = (msg) =>
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\\n");
const reply = (id, result) => send({ id, result });
process.stdin.on("data", (d) => {
	buf += d;
	let i = buf.indexOf("\\n");
	while (i >= 0) {
		const msg = JSON.parse(buf.slice(0, i));
		buf = buf.slice(i + 1);
		i = buf.indexOf("\\n");
		if (msg.id === 1 && reject) {
			send({ id: 1, error: { code: -32602, message: "unsupported protocol" } });
		} else if (msg.id === 1 && mode === "init-no-result") send({ id: 1 });
		else if (msg.id === 1) setTimeout(() => reply(1, {}), delayMs);
		if (msg.id === 2 && mode === "verify-no-result") send({ id: 2 });
		else if (msg.id === 2 && mode === "verify-unstructured")
			reply(2, { content: [{ type: "text", text: "ok" }] });
		else if (msg.id === 2)
			reply(2, {
				content: [{ type: "text", text: "verify: passed" }],
				structuredContent: {
					data: { passed: true, tools: [] },
					error: null,
					meta: { tool: "verify" },
				},
			});
	}
});
`;

describe("probeLaunch", () => {
	const withServer = async (
		delayMs: number,
		budgetMs: number,
		mode:
			| "accept"
			| "reject"
			| "init-no-result"
			| "verify-no-result"
			| "verify-unstructured" = "accept",
	): Promise<Awaited<ReturnType<typeof probeLaunch>>> => {
		const dir = mkdtempSync(join(tmpdir(), "maina-probe-"));
		const script = join(dir, "server.js");
		writeFileSync(script, FAKE_SERVER);
		try {
			return await probeLaunch(
				{
					command: process.execPath,
					args: [script, String(delayMs), mode],
					env: {},
					source: "test",
				},
				{ PATH: process.env.PATH ?? "", HOME: dir },
				dir,
				{ coldStartBudgetMs: budgetMs },
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};

	test("a fast server starts and answers verify", async () => {
		const r = await withServer(0, 5_000);
		expect(r.error).toBeUndefined();
		expect(r.started).toBe(true);
		expect(r.toolCallOk).toBe(true);
	});

	test("over budget still reports started=true (initialize did complete)", async () => {
		const r = await withServer(300, 100);
		expect(r.started).toBe(true);
		expect(r.handshakeMs).toBeGreaterThanOrEqual(300);
		expect(r.toolCallOk).toBe(true);
		expect(r.error?.kind).toBe("cold-start-over-budget");
		expect(r.error && classifyProblem(r.error)).toBe("P4");
	});

	test("an initialize response with no result is not a start", async () => {
		const r = await withServer(0, 5_000, "init-no-result");
		expect(r.started).toBe(false);
		expect(r.handshakeMs).toBeNull();
		expect(r.toolCallOk).toBe(false);
		expect(r.error?.kind).toBe("handshake-rejected");
	});

	test("a verify response with no result is not a successful tool call", async () => {
		const r = await withServer(0, 5_000, "verify-no-result");
		expect(r.started).toBe(true);
		expect(r.toolCallOk).toBe(false);
		expect(r.error?.kind).toBe("tool-call-failed");
	});

	test("a verify answer without per-tool status is not a successful tool call (#335, #421)", async () => {
		const r = await withServer(0, 5_000, "verify-unstructured");
		expect(r.started).toBe(true);
		expect(r.toolCallOk).toBe(false);
		expect(r.error?.kind).toBe("tool-call-failed");
		expect(r.error?.message).toContain("per-tool status");
	});

	test("a bare command resolves on the PATH the entry's own env sets", async () => {
		// Hosts spawn with the entry env merged over theirs, and spawn looks
		// the command up on that merged PATH.
		const dir = mkdtempSync(join(tmpdir(), "maina-probe-path-"));
		writeFileSync(join(dir, "server.js"), FAKE_SERVER);
		const launcher = join(dir, "fake-maina-mcp");
		writeFileSync(
			launcher,
			`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$(dirname "$0")/server.js" 0 accept\n`,
		);
		chmodSync(launcher, 0o755);
		try {
			const r = await probeLaunch(
				{
					command: "fake-maina-mcp",
					args: [],
					env: { PATH: `${dir}:${GUI_PATH.linux}` },
					source: "test",
				},
				{ PATH: GUI_PATH.linux, HOME: dir },
				dir,
				{ coldStartBudgetMs: 5_000 },
			);
			expect(r.error).toBeUndefined();
			expect(r.started).toBe(true);
			expect(r.toolCallOk).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a relative command resolves against the case cwd, as a host spawns it", async () => {
		// The harness process runs from the repo root; the host spawns from
		// the project dir. `./server` exists only in the latter.
		const dir = mkdtempSync(join(tmpdir(), "maina-probe-rel-"));
		writeFileSync(join(dir, "server.js"), FAKE_SERVER);
		const launcher = join(dir, "server");
		writeFileSync(
			launcher,
			`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$(dirname "$0")/server.js" 0 accept\n`,
		);
		chmodSync(launcher, 0o755);
		try {
			const r = await probeLaunch(
				{ command: "./server", args: [], env: {}, source: "test" },
				{ PATH: process.env.PATH ?? "", HOME: dir },
				dir,
				{ coldStartBudgetMs: 5_000 },
			);
			expect(r.error).toBeUndefined();
			expect(r.started).toBe(true);
			expect(r.toolCallOk).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an initialize answered with a JSON-RPC error is not a start", async () => {
		const r = await withServer(0, 5_000, "reject");
		expect(r.started).toBe(false);
		expect(r.handshakeMs).toBeNull();
		expect(r.toolCallOk).toBe(false);
		expect(r.error?.kind).toBe("handshake-rejected");
		expect(r.error?.message).toContain("unsupported protocol");
	});
});

// ── Workspace ──────────────────────────────────────────────────────────────

describe("createWorkspace", () => {
	test("sandbox HOME opts out of CLI crash reports without touching the launch env", () => {
		// GUI/minimal launches carry no MAINA_TELEMETRY / DO_NOT_TRACK (that is
		// the point), so the opt-out lives in the sandboxed HOME instead: a
		// crashing server under test must not report to production.
		const w = createWorkspace("linux", true);
		try {
			const raw = readFileSync(
				join(w.home, ".maina", "telemetry.json"),
				"utf-8",
			);
			expect(JSON.parse(raw)).toEqual({ optOut: true });
			const env = hostEnv("minimal", {
				os: "linux",
				home: w.home,
				shellEnv: w.shellEnv,
			});
			expect(env).toEqual({ PATH: GUI_PATH.linux, HOME: w.home });
		} finally {
			rmSync(w.root, { recursive: true, force: true });
		}
	});
});

// ── Problem classification ─────────────────────────────────────────────────

describe("classifyProblem", () => {
	const err = (e: CaseError) => classifyProblem(e);

	test("exit 127 from `env: bun` is P2", () => {
		expect(
			err({
				kind: "exited",
				message: "x",
				exitCode: 127,
				stderr: "env: bun: No such file or directory",
			}),
		).toBe("P2");
	});

	test("launcher missing from PATH is P2", () => {
		expect(
			err({ kind: "command-not-found", message: "x", command: "bunx" }),
		).toBe("P2");
	});

	test("unresolvable version pin is P3", () => {
		expect(
			err({
				kind: "exited",
				message: "x",
				exitCode: 1,
				stderr:
					'error: No version matching "9.9.9" found for specifier "@mainahq/cli"',
			}),
		).toBe("P3");
		expect(
			err({
				kind: "exited",
				message: "x",
				exitCode: 1,
				stderr: "npm error code ETARGET",
			}),
		).toBe("P3");
	});

	test("slow or hung start is P4", () => {
		expect(
			err({ kind: "handshake-timeout", message: "x", timeoutMs: 10_000 }),
		).toBe("P4");
		expect(
			err({
				kind: "cold-start-over-budget",
				message: "x",
				handshakeMs: 3_000,
				budgetMs: 1_500,
			}),
		).toBe("P4");
	});

	test("missing plugin package is its own class", () => {
		expect(err({ kind: "installer-missing", message: "x" })).toBe("no-plugin");
	});
});

// ── Known-failure table hygiene ────────────────────────────────────────────

describe("KNOWN_FAILURES", () => {
	test("every accepted problem links the issue that fixes it", () => {
		for (const k of KNOWN_FAILURES) {
			expect(problemsOf(k).length).toBeGreaterThan(0);
			for (const p of problemsOf(k)) expect(k.fixes[p]).toBeGreaterThan(0);
		}
	});

	test("CLI install paths no longer wait on #294 (compiled packages)", () => {
		// The CLI writes its own runtime + entry by absolute path, so neither
		// a GUI PATH without bun (P2) nor an unpublished version pin (P3)
		// can stop the server from starting on these paths.
		for (const k of KNOWN_FAILURES) {
			expect(Object.values(k.fixes)).not.toContain(294);
		}
		for (const host of ["cursor", "codex"] as const) {
			for (const env of ["minimal", "gui", "full"] as const) {
				expect(
					expectedFailure({ host, installPath: "cli-mcp-add", env }),
				).toBeUndefined();
			}
		}
		for (const env of ["minimal", "gui", "full"] as const) {
			expect(
				expectedFailure({ host: "cursor", installPath: "cli-setup", env }),
			).toBeUndefined();
		}
	});

	test("claude-code × cli-setup no longer fails P1 (#288 writes .mcp.json)", () => {
		// `maina setup` merges `mcpServers.maina` into the project `.mcp.json`,
		// which Claude Code reads, so the server starts on this path.
		for (const env of ["minimal", "gui", "full"] as const) {
			expect(
				expectedFailure({ host: "claude-code", installPath: "cli-setup", env }),
			).toBeUndefined();
		}
	});

	test("only latency-bound (P4-only) entries may pass", () => {
		for (const k of KNOWN_FAILURES.filter((k) => k.mayPass === true)) {
			expect(problemsOf(k)).toEqual(["P4"]);
		}
	});

	test("no install path waits on #299 (host config merge)", () => {
		// Every installer goes through the CLI's host targets: Claude Code
		// gets `.mcp.json` / `~/.claude.json` (P1), Codex gets its
		// config.toml (P1), install.sh no longer writes a bare `bunx` (P2)
		// and nothing rewrites a user's config wholesale (P8).
		for (const k of KNOWN_FAILURES) {
			expect(Object.values(k.fixes)).not.toContain(299);
		}
		for (const host of HOSTS) {
			for (const installPath of [
				"cli-setup",
				"cli-mcp-add",
				"install-sh",
			] as const) {
				for (const env of ENV_MODES) {
					expect(expectedFailure({ host, installPath, env })).toBeUndefined();
				}
			}
		}
	});

	test("P1, P2, P3 and P8 are no longer reproduced by any case", () => {
		// P3 (unresolvable version pin) was fixed by #294: a stable CLI launches
		// itself, and the registry fallback pins VERSION, which the release
		// publishes (launcher.test.ts covers the fallback). P1, P2 and P8
		// were fixed by #299.
		const covered = new Set(KNOWN_FAILURES.flatMap((k) => problemsOf(k)));
		for (const p of ["P1", "P2", "P3", "P8"] as const) {
			expect(covered.has(p)).toBe(false);
		}
	});
});

// ── Seeded host configs (P8) ───────────────────────────────────────────────

describe("checkSeeds", () => {
	const seeded = (host: (typeof HOSTS)[number]) =>
		new Map(seedsFor(host, ctx).map((s) => [s.path, s.content]));

	test("every host seeds its global config with keys that are not maina's", () => {
		for (const host of HOSTS) {
			const seeds = seedsFor(host, ctx);
			expect(seeds.length).toBeGreaterThan(0);
			for (const s of seeds) {
				expect(s.path.startsWith("/h/")).toBe(true);
				expect(s.content).not.toContain("maina");
			}
		}
	});

	test("seeded configs that still hold their own keys pass", () => {
		for (const host of HOSTS) {
			const map = seeded(host);
			expect(checkSeeds(host, ctx, (p) => map.get(p) ?? null)).toEqual({
				ok: true,
				value: undefined,
			});
		}
	});

	test("a seeded config rewritten without its own keys is P8", () => {
		const clobbered = entry("/bin/maina");
		const r = checkSeeds("cursor", ctx, () => clobbered);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.kind).toBe("config-clobbered");
		expect(classifyProblem(r.error)).toBe("P8");
	});

	test("a seeded config that was deleted is P8 too", () => {
		const r = checkSeeds("codex", ctx, () => null);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(classifyProblem(r.error)).toBe("P8");
	});
});

// ── The matrix ─────────────────────────────────────────────────────────────

const osResult = currentOs(process.platform);
const strict = process.env.MAINA_E2E_STRICT === "1";
const pick = <T extends string>(all: readonly T[], filter?: string) =>
	filter ? all.filter((x) => filter.split(",").includes(x)) : all;

describe.skipIf(!osResult.ok)("real-config matrix", () => {
	const os = osResult.ok ? osResult.value : "linux";
	for (const host of pick(HOSTS, process.env.E2E_HOST)) {
		for (const installPath of pick(
			INSTALL_PATHS,
			process.env.E2E_INSTALL_PATH,
		)) {
			for (const env of pick(ENV_MODES, process.env.E2E_ENV)) {
				const known = strict
					? undefined
					: expectedFailure({ host, installPath, env });
				const label = known
					? `${host} × ${installPath} × ${env} (expected-fail ${problemsOf(
							known,
						)
							.map((p) => `${p} → #${known.fixes[p]}`)
							.join(" | ")}${known.mayPass ? ", or pass" : ""})`
					: `${host} × ${installPath} × ${env}`;

				test(label, async () => {
					const r = await runCase({ host, os, installPath, env });
					const passed = r.error === undefined && r.started && r.toolCallOk;
					if (known) {
						if (known.mayPass && passed) return;
						expect(passed).toBe(false);
						expect(r.error).toBeDefined();
						const problem = r.error ? classifyProblem(r.error) : undefined;
						// Diff shows the full error when the reason drifts.
						expect({ problem, error: r.error }).toMatchObject({
							problem: expect.stringMatching(
								new RegExp(`^(${problemsOf(known).join("|")})$`),
							),
						});
						return;
					}
					expect(r.error).toBeUndefined();
					expect(r.started).toBe(true);
					expect(r.toolCallOk).toBe(true);
				}, 180_000);
			}
		}
	}
});
