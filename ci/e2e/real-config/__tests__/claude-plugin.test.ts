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
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
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
import { measureFirstResult, measureUninstall } from "../measurements";
import {
	type PluginRelease,
	pluginRelease,
	stopPluginRelease,
} from "../plugin-release";
import type { PathCtx } from "../types";
import {
	alive,
	type Bookkeeping,
	runtimeAddress,
	runtimePid,
	snapshot,
	traces,
	waitFor,
} from "../uninstall-traces";

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

	test(
		"marketplace add + install on a clean machine: the first session.start onboards and the first verify answers within 60 s",
		() =>
			measureFirstResult("claude", async () => {
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
				expect(launch.value.source).toBe(
					join(installed?.root ?? "", ".mcp.json"),
				);
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
			}),
		90_000,
	);

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

	// #526: the standalone runtime embeds tree-sitter, so the gate tells Bash
	// commands apart instead of asking for every one as `shell.opaque`.
	test("Bash commands are classified in the standalone runtime (#526)", async () => {
		if (plugin === undefined) throw new Error("claude-code has no plugin");
		const w = workspace();
		const ctx = await install(w);
		expect((await plugin.startSession(ctx, guiEnv(w))).ok).toBe(true);
		const harmless = await bash(w, "echo hello");
		expect(harmless.map((a) => a.permissionDecision)).toEqual(["allow"]);
		const wipe = await bash(w, "rm -rf ~/.claude");
		expect(wipe.map((a) => a.permissionDecision)).toEqual(["deny"]);
	}, 90_000);

	test(
		"uninstall leaves no trace",
		() =>
			measureUninstall("claude", async (report) => {
				if (plugin === undefined) throw new Error("claude-code has no plugin");
				const w = workspace();
				const ctx: PathCtx = { home: w.home, cwd: w.cwd };
				// A Claude Code user with their own config, before they install.
				for (const seed of seedsFor("claude-code", ctx)) {
					await Bun.write(seed.path, seed.content);
				}
				const before = snapshot(w.root);

				await install(w);
				const [installed] = enabledPlugins(w.home, readOrNull);
				if (installed === undefined) throw new Error("plugin not enabled");
				const env = guiEnv(w);
				expect((await plugin.startSession(ctx, env)).ok).toBe(true);
				const launch = resolveLaunch("claude-code", ctx, readOrNull);
				if (!launch.ok) throw new Error(launch.error.message);
				expect((await probeLaunch(launch.value, env, w.cwd)).toolCallOk).toBe(
					true,
				);
				await write(w, join(w.cwd, "notes.md"));

				// The runtime the hooks started is running, claimed in the plugin's
				// data dir, listening where its command line says.
				const runDir = join(installed.data, "run");
				expect(await waitFor(() => runtimePid(runDir) !== null, 10_000)).toBe(
					true,
				);
				const pid = runtimePid(runDir) ?? 0;
				const socket = runtimeAddress(pid);
				expect(socket).toBeDefined();
				expect(
					await waitFor(
						() => socket !== undefined && existsSync(socket),
						10_000,
					),
				).toBe(true);

				expect(pluginUninstall(w.home, MAINA_PLUGIN, readOrNull).ok).toBe(true);
				expect(marketplaceRemove(w.home, "maina", readOrNull).ok).toBe(true);

				// No maina process outlives the plugin, nor its socket wherever it
				// had to live, and every file is as it was, but for the host's own
				// (now empty) plugin bookkeeping.
				const gone = await waitFor(() => !alive(pid), 15_000);
				const left = [
					...(gone ? [] : [`runtime pid ${pid} still running`]),
					...(socket !== undefined && existsSync(socket)
						? [`socket ${socket}`]
						: []),
					...(socket !== undefined && existsSync(dirname(socket))
						? [`socket dir ${dirname(socket)}`]
						: []),
					...(checkSeeds("claude-code", ctx, readOrNull).ok
						? []
						: ["the user's own config changed"]),
					...traces(before, snapshot(w.root), BOOKKEEPING),
					...[...BOOKKEEPING_FILES]
						.filter((f) =>
							(readOrNull(join(w.root, f)) ?? "").includes("maina"),
						)
						.map((f) => `${f} still names maina`),
				];
				report(left);
				expect(left).toEqual([]);
			}),
		120_000,
	);
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Claude Code's own plugin bookkeeping, kept after the last uninstall: its
 * plugins dirs and two JSON indexes, which must no longer name maina.
 */
const BOOKKEEPING_FILES = new Set([
	"home/.claude/plugins/known_marketplaces.json",
	"home/.claude/plugins/installed_plugins.json",
]);
const BOOKKEEPING: Bookkeeping = {
	dirs: new Set([
		"home/.claude/plugins",
		"home/.claude/plugins/cache",
		"home/.claude/plugins/data",
		"home/.claude/plugins/marketplaces",
	]),
	files: BOOKKEEPING_FILES,
};
