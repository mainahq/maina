/**
 * The Claude Code plugin install path (v1 task 9.2, spec §5, G1).
 *
 * A user runs `/plugin marketplace add mainahq/maina` and `/plugin install
 * maina@maina`. This does what Claude Code does on disk for both (see
 * `../hosts/claude-code.ts`), from a local release of this checkout
 * (`../plugin-release.ts`), then runs the plugin the way a session does:
 * its hooks through the shell, its MCP server from its `.mcp.json`, with
 * the GUI-launched env (no bun, no node on PATH).
 *
 *   - install on a clean machine → the first `session.start` onboards and
 *     the first `verify` answers, all within 60 s
 *   - a destructive fixture command is denied
 *   - uninstall (and marketplace remove) leaves no trace: no file, no
 *     running runtime, no socket
 *
 * Runs in the claude-code `plugin` cell of the e2e workflow (and locally
 * when no cell filter is set).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { currentOs, hostEnv } from "../env";
import { runHookCommand } from "../hook-process";
import {
	bashInput,
	claudeCode,
	enabledPlugins,
	hookEnv,
	MAINA_PLUGIN,
	marketplaceRemove,
	ONBOARDING,
	pluginHooks,
	pluginUninstall,
	writeInput,
} from "../hosts/claude-code";
import {
	checkSeeds,
	createWorkspace,
	probeLaunch,
	resolveLaunch,
	seedsFor,
	type Workspace,
} from "../matrix";
import {
	type PluginRelease,
	pluginRelease,
	stopPluginRelease,
} from "../plugin-release";
import type { PathCtx } from "../types";

const cellPath = process.env.E2E_INSTALL_PATH;
const cellHost = process.env.E2E_HOST;
const os = currentOs(process.platform);
const runsHere =
	os.ok &&
	(cellPath === undefined || cellPath === "plugin") &&
	(cellHost === undefined || cellHost === "claude-code");

/** Install → first onboarding + first verify (issue #341). */
const FIRST_VERIFY_BUDGET_MS = 60_000;

const readOrNull = (path: string): string | null => {
	try {
		return existsSync(path) ? readFileSync(path, "utf-8") : null;
	} catch {
		return null;
	}
};

const plugin = claudeCode.plugin;

describe.skipIf(!runsHere)("Claude Code plugin (#341)", () => {
	let release: PluginRelease;
	const workspaces: Workspace[] = [];

	beforeAll(async () => {
		const staged = await pluginRelease();
		if (!staged.ok) throw new Error(staged.error);
		release = staged.value;
	}, 120_000);

	afterAll(() => {
		stopPluginRelease();
		for (const w of workspaces) {
			rmSync(w.root, { recursive: true, force: true });
		}
	});

	const workspace = (): Workspace => {
		const w = createWorkspace(os.ok ? os.value : "linux", false);
		workspaces.push(w);
		return w;
	};

	const guiEnv = (w: Workspace) =>
		hostEnv("minimal", {
			os: os.ok ? os.value : "linux",
			home: w.home,
			shellEnv: w.shellEnv,
		});

	/** Every PreToolUse hook's answer for one tool call. */
	const preToolUse = async (w: Workspace, tool: string, input: unknown) => {
		const hooks = pluginHooks(w.home, readOrNull, "PreToolUse", tool);
		expect(hooks.length).toBeGreaterThan(0);
		return Promise.all(
			hooks.map(async (hook) => {
				const run = await runHookCommand(
					hook.command,
					input,
					hookEnv(guiEnv(w), hook.plugin, w.cwd),
					w.cwd,
				);
				const out = JSON.parse(run.stdout.trim() || "{}") as {
					hookSpecificOutput?: {
						permissionDecision?: string;
						permissionDecisionReason?: string;
					};
				};
				return { exitCode: run.exitCode, ...out.hookSpecificOutput };
			}),
		);
	};

	const bash = (w: Workspace, command: string) =>
		preToolUse(w, "Bash", bashInput(w.cwd, command));

	const write = (w: Workspace, path: string) =>
		preToolUse(w, "Write", writeInput(w.cwd, path, "{}\n"));

	const install = async (w: Workspace) => {
		if (plugin === undefined) throw new Error("claude-code has no plugin");
		const ctx: PathCtx = { home: w.home, cwd: w.cwd };
		const installed = plugin.install(ctx, release.marketplace);
		expect(installed).toEqual({ ok: true, value: undefined });
		return ctx;
	};

	test("marketplace add + install on a clean machine: the first session.start onboards and the first verify answers within 60 s", async () => {
		if (plugin === undefined) throw new Error("claude-code has no plugin");
		const w = workspace();
		const env = guiEnv(w);
		const t0 = performance.now();
		const ctx = await install(w);

		const session = await plugin.startSession(ctx, env);
		expect(session.ok).toBe(true);
		if (session.ok) expect(session.value).toContain(ONBOARDING);

		const launch = resolveLaunch("claude-code", ctx, readOrNull);
		expect(launch.ok).toBe(true);
		if (!launch.ok) return;
		const [installed] = enabledPlugins(w.home, readOrNull);
		expect(launch.value.source).toBe(join(installed?.root ?? "", ".mcp.json"));
		const verified = await probeLaunch(launch.value, env, w.cwd, {
			coldStartBudgetMs: FIRST_VERIFY_BUDGET_MS,
		});
		const elapsedMs = performance.now() - t0;
		expect(verified.error).toBeUndefined();
		expect(verified.started).toBe(true);
		expect(verified.toolCallOk).toBe(true);
		expect(elapsedMs).toBeLessThanOrEqual(FIRST_VERIFY_BUDGET_MS);
		// The runtime came from the release, once.
		expect(release.downloads().length).toBeGreaterThan(0);
	}, 90_000);

	test("a destructive fixture command is denied", async () => {
		if (plugin === undefined) throw new Error("claude-code has no plugin");
		const w = workspace();
		const ctx = await install(w);
		expect((await plugin.startSession(ctx, guiEnv(w))).ok).toBe(true);

		// The gate is live, not the launcher's fail-closed answer: a harmless
		// write in the project is allowed.
		const harmless = await write(w, join(w.cwd, "notes.md"));
		expect(harmless.map((a) => a.permissionDecision)).toEqual(["allow"]);

		// Overwriting the user's Claude Code config (their settings and
		// maina's own hooks) is denied outright, exit 2, whatever the
		// permission mode.
		const wipe = await write(w, join(w.home, ".claude", "settings.json"));
		expect(wipe.map((a) => a.permissionDecision)).toEqual(["deny"]);
		expect(wipe.map((a) => a.exitCode)).toEqual([2]);

		// Irreversible commands the user may still approve are never allowed.
		const rootWipe = await bash(w, "rm -rf /");
		expect(rootWipe.map((a) => a.permissionDecision)).toEqual(["ask"]);
	}, 90_000);

	// #526: the standalone runtime cannot load tree-sitter, so every Bash
	// command is `shell.opaque` (ask). When that is fixed this starts
	// passing, `test.failing` goes red: make it a plain `test`.
	test.failing("Bash commands are classified in the standalone runtime (#526)", async () => {
		if (plugin === undefined) throw new Error("claude-code has no plugin");
		const w = workspace();
		const ctx = await install(w);
		expect((await plugin.startSession(ctx, guiEnv(w))).ok).toBe(true);
		const harmless = await bash(w, "echo hello");
		expect(harmless.map((a) => a.permissionDecision)).toEqual(["allow"]);
		const wipe = await bash(w, "rm -rf ~/.claude");
		expect(wipe.map((a) => a.permissionDecision)).toEqual(["deny"]);
	}, 90_000);

	test("uninstall leaves no trace", async () => {
		if (plugin === undefined) throw new Error("claude-code has no plugin");
		const w = workspace();
		const ctx: PathCtx = { home: w.home, cwd: w.cwd };
		// A Claude Code user with their own config, before they install.
		for (const seed of seedsFor("claude-code", ctx)) {
			await Bun.write(seed.path, seed.content);
		}
		const before = snapshot(w);

		await install(w);
		const [installed] = enabledPlugins(w.home, readOrNull);
		if (installed === undefined) throw new Error("plugin not enabled");
		const env = guiEnv(w);
		expect((await plugin.startSession(ctx, env)).ok).toBe(true);
		const launch = resolveLaunch("claude-code", ctx, readOrNull);
		if (!launch.ok) throw new Error(launch.error.message);
		expect((await probeLaunch(launch.value, env, w.cwd)).toolCallOk).toBe(true);
		await write(w, join(w.cwd, "notes.md"));

		// The runtime the hooks started is running, claimed in the plugin's
		// data dir, listening where its command line says.
		const runDir = join(installed.data, "run");
		expect(await waitFor(() => runtimePid(runDir) !== null, 10_000)).toBe(true);
		const pid = runtimePid(runDir) ?? 0;
		const socket = runtimeAddress(pid);
		expect(socket).toBeDefined();
		expect(
			await waitFor(() => socket !== undefined && existsSync(socket), 10_000),
		).toBe(true);

		expect(pluginUninstall(w.home, MAINA_PLUGIN, readOrNull).ok).toBe(true);
		expect(marketplaceRemove(w.home, "maina", readOrNull).ok).toBe(true);

		// No maina process outlives the plugin.
		expect(await waitFor(() => !alive(pid), 15_000)).toBe(true);
		// Nor its socket, wherever it had to live.
		expect(socket !== undefined && existsSync(socket)).toBe(false);
		expect(socket !== undefined && existsSync(dirname(socket))).toBe(false);
		// Every file is as it was, but for Claude Code's own (now empty)
		// plugin bookkeeping.
		expect(checkSeeds("claude-code", ctx, readOrNull).ok).toBe(true);
		expect(traces(before, snapshot(w))).toEqual([]);
		for (const file of BOOKKEEPING_FILES) {
			expect(readOrNull(join(w.root, file)) ?? "").not.toContain("maina");
		}
	}, 120_000);
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Path (from the workspace root) → what is there. */
type Snapshot = ReadonlyMap<string, string>;

/** Git's own state, which any git command may touch. */
const GIT_INTERNALS = /^project\/\.git\//;

function snapshot(w: Workspace): Snapshot {
	const out = new Map<string, string>();
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			const rel = relative(w.root, full);
			if (GIT_INTERNALS.test(rel)) continue;
			const stat = lstatSync(full);
			if (stat.isSymbolicLink()) out.set(rel, `link:${readlinkSync(full)}`);
			else if (stat.isDirectory()) {
				out.set(rel, "dir");
				walk(full);
			} else out.set(rel, `file:${Bun.hash(readFileSync(full))}`);
		}
	};
	walk(w.root);
	return out;
}

/**
 * Claude Code's own plugin bookkeeping, kept after the last uninstall: its
 * plugins dirs and two JSON indexes, which must no longer name maina.
 */
const BOOKKEEPING_DIRS = new Set([
	"home/.claude/plugins",
	"home/.claude/plugins/cache",
	"home/.claude/plugins/data",
	"home/.claude/plugins/marketplaces",
]);
const BOOKKEEPING_FILES = new Set([
	"home/.claude/plugins/known_marketplaces.json",
	"home/.claude/plugins/installed_plugins.json",
]);

/** What install → use → uninstall left behind, as readable strings. */
function traces(before: Snapshot, after: Snapshot): readonly string[] {
	const found: string[] = [];
	for (const [path, what] of after) {
		const was = before.get(path);
		if (was === what) continue;
		if (was === undefined && BOOKKEEPING_DIRS.has(path)) continue;
		if (BOOKKEEPING_FILES.has(path)) continue;
		found.push(`${was === undefined ? "added" : "changed"} ${path}`);
	}
	for (const path of before.keys()) {
		if (!after.has(path)) found.push(`removed ${path}`);
	}
	return found.sort();
}

/**
 * The socket a running runtime listens on, from its `--address` argument:
 * its runtime dir, or a private dir under tmp when that is too deep.
 */
function runtimeAddress(pid: number): string | undefined {
	const ps = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]);
	return /--address (\S+)/.exec(ps.stdout.toString())?.[1];
}

/** The pid the runtime's pid file in `runDir` names. */
function runtimePid(runDir: string): number | null {
	const pidFile = existsSync(runDir)
		? readdirSync(runDir).find((name) => name.endsWith(".pid"))
		: undefined;
	const raw = pidFile === undefined ? null : readOrNull(join(runDir, pidFile));
	if (raw === null) return null;
	const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
	return typeof pid === "number" ? pid : null;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (check()) return true;
		await Bun.sleep(100);
	}
	return check();
}
