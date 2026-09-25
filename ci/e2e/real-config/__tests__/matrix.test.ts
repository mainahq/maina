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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentOs, GUI_PATH, hostEnv, minimalEnv } from "../env";
import {
	type CaseError,
	classifyProblem,
	ENV_MODES,
	expectedFailure,
	HOSTS,
	INSTALL_PATHS,
	KNOWN_FAILURES,
	probeLaunch,
	resolveLaunch,
	runCase,
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

/** A fake MCP server: answers `initialize` after `delayMs`, then `verify`. */
const FAKE_SERVER = `
const delayMs = Number(process.argv[2]);
let buf = "";
const reply = (id, result) =>
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
process.stdin.on("data", (d) => {
	buf += d;
	let i = buf.indexOf("\\n");
	while (i >= 0) {
		const msg = JSON.parse(buf.slice(0, i));
		buf = buf.slice(i + 1);
		i = buf.indexOf("\\n");
		if (msg.id === 1) setTimeout(() => reply(1, {}), delayMs);
		if (msg.id === 2) reply(2, { content: [{ type: "text", text: "ok" }] });
	}
});
`;

describe("probeLaunch", () => {
	const withServer = async (
		delayMs: number,
		budgetMs: number,
	): Promise<Awaited<ReturnType<typeof probeLaunch>>> => {
		const dir = mkdtempSync(join(tmpdir(), "maina-probe-"));
		const script = join(dir, "server.js");
		writeFileSync(script, FAKE_SERVER);
		try {
			return await probeLaunch(
				{
					command: process.execPath,
					args: [script, String(delayMs)],
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
	test("every entry links the issue that fixes it", () => {
		for (const k of KNOWN_FAILURES) {
			expect(k.issue).toBeGreaterThan(0);
			expect(k.problems.length).toBeGreaterThan(0);
		}
	});

	test("only latency-bound (P4-only) entries may pass", () => {
		for (const k of KNOWN_FAILURES.filter((k) => k.mayPass === true)) {
			expect(k.problems).toEqual(["P4"]);
		}
	});

	test("P1–P4 are each reproduced by at least one case", () => {
		const covered = new Set(KNOWN_FAILURES.flatMap((k) => k.problems));
		for (const p of ["P1", "P2", "P3", "P4"] as const) {
			expect(covered.has(p)).toBe(true);
		}
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
					? `${host} × ${installPath} × ${env} (expected-fail ${known.problems.join("|")}${known.mayPass ? " or pass" : ""}, fixed by #${known.issue})`
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
								new RegExp(`^(${known.problems.join("|")})$`),
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
