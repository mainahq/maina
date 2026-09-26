/**
 * The Cursor plugin install path (v1 task 9.3, spec §5, G1): the same cases
 * as the Claude Code plugin (#341), for Cursor.
 *
 * A team imports this repo as a Team Marketplace (or installs maina from
 * the Cursor Marketplace), then installs the plugin. This does what Cursor
 * does on disk (see `../hosts/cursor.ts`), from a local release of this
 * checkout (`../plugin-release.ts`), then runs the plugin the way a session
 * does: its hooks through the shell from the plugin root, its MCP server
 * from its `mcp.json`, with the GUI-launched env (no bun, no node on PATH).
 *
 *   - install on a clean machine → the first `sessionStart` onboards and
 *     the first `verify` answers, all within 60 s
 *   - a destructive fixture command is denied
 *   - uninstall leaves no trace: no file, no running runtime, no socket
 *
 * Runs in the cursor `plugin` cell of the e2e workflow (and locally when no
 * cell filter is set).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentOs, hostEnv } from "../env";
import { ONBOARDING } from "../hosts/claude-code";
import {
	CURSOR_PLUGIN,
	cursor,
	installedPlugins,
	pluginHooks,
	pluginUninstall,
	runPluginHook,
	shellInput,
	writeInput,
} from "../hosts/cursor";
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
	(cellHost === undefined || cellHost === "cursor");

/** Install → first onboarding + first verify (issue #341, same for #342). */
const FIRST_VERIFY_BUDGET_MS = 60_000;

const readOrNull = (path: string): string | null => {
	try {
		return existsSync(path) ? readFileSync(path, "utf-8") : null;
	} catch {
		return null;
	}
};

const plugin = cursor.plugin;

/** Cursor's plugin dirs, which it keeps once the last plugin is gone. */
const BOOKKEEPING: Bookkeeping = {
	dirs: new Set(["home/.cursor/plugins", "home/.cursor/plugins/local"]),
	files: new Set(),
};

type Answer = Readonly<{ exitCode: number | null; permission?: string }>;

describe.skipIf(!runsHere)("Cursor plugin (#342)", () => {
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

	/** Every installed plugin's answer to one permission hook. */
	const ask = async (
		w: Workspace,
		event: string,
		input: unknown,
	): Promise<readonly Answer[]> => {
		const hooks = pluginHooks(w.home, readOrNull, event);
		expect(hooks.length).toBeGreaterThan(0);
		return Promise.all(
			hooks.map(async (hook) => {
				const run = await runPluginHook(hook, input, guiEnv(w), w.cwd);
				const out = JSON.parse(run.stdout.trim() || "{}") as {
					permission?: string;
				};
				return { exitCode: run.exitCode, permission: out.permission };
			}),
		);
	};

	const write = (w: Workspace, path: string) =>
		ask(w, "preToolUse", writeInput(w.cwd, path, "{}\n"));

	const shell = (w: Workspace, command: string) =>
		ask(w, "beforeShellExecution", shellInput(w.cwd, command));

	const install = async (w: Workspace): Promise<PathCtx> => {
		if (plugin === undefined) throw new Error("cursor has no plugin");
		const ctx: PathCtx = { home: w.home, cwd: w.cwd };
		const installed = plugin.install(ctx, release.marketplace);
		expect(installed).toEqual({ ok: true, value: undefined });
		return ctx;
	};

	test("marketplace install on a clean machine: the first sessionStart onboards and the first verify answers within 60 s", async () => {
		if (plugin === undefined) throw new Error("cursor has no plugin");
		const w = workspace();
		const env = guiEnv(w);
		const t0 = performance.now();
		const ctx = await install(w);

		const session = await plugin.startSession(ctx, env);
		expect(session.ok).toBe(true);
		if (session.ok) expect(session.value).toContain(ONBOARDING);

		const launch = resolveLaunch("cursor", ctx, readOrNull);
		expect(launch.ok).toBe(true);
		if (!launch.ok) return;
		const [installed] = installedPlugins(w.home, readOrNull);
		expect(installed?.name).toBe(CURSOR_PLUGIN);
		expect(launch.value.source).toBe(join(installed?.root ?? "", "mcp.json"));
		// The runtime lives inside the plugin, not in ~/.maina.
		expect(launch.value.env.PLUGIN_DATA).toBe(
			join(installed?.root ?? "", "data"),
		);
		const verified = await probeLaunch(launch.value, env, w.cwd, {
			coldStartBudgetMs: FIRST_VERIFY_BUDGET_MS,
		});
		const elapsedMs = performance.now() - t0;
		expect(verified.error).toBeUndefined();
		expect(verified.started).toBe(true);
		expect(verified.toolCallOk).toBe(true);
		expect(elapsedMs).toBeLessThanOrEqual(FIRST_VERIFY_BUDGET_MS);
		expect(release.downloads().length).toBeGreaterThan(0);
		expect(existsSync(join(w.home, ".maina", "runtime"))).toBe(false);
	}, 90_000);

	test("a destructive fixture command is denied", async () => {
		if (plugin === undefined) throw new Error("cursor has no plugin");
		const w = workspace();
		const ctx = await install(w);
		expect((await plugin.startSession(ctx, guiEnv(w))).ok).toBe(true);

		// The gate is live, not the launcher's fail-closed answer: a harmless
		// write in the project is allowed.
		const harmless = await write(w, join(w.cwd, "notes.md"));
		expect(harmless.map((a) => a.permission)).toEqual(["allow"]);

		// Overwriting the user's Cursor hooks (where maina's own could be
		// switched off) is denied outright, exit 2.
		const wipe = await write(w, join(w.home, ".cursor", "hooks.json"));
		expect(wipe.map((a) => a.permission)).toEqual(["deny"]);
		expect(wipe.map((a) => a.exitCode)).toEqual([2]);

		// Irreversible commands the user may still approve are never allowed.
		const rootWipe = await shell(w, "rm -rf /");
		expect(rootWipe.map((a) => a.permission)).toEqual(["ask"]);
	}, 90_000);

	// #526: the standalone runtime cannot load tree-sitter, so every shell
	// command is `shell.opaque` (ask). When that is fixed this starts
	// passing, `test.failing` goes red: make it a plain `test`.
	test.failing("shell commands are classified in the standalone runtime (#526)", async () => {
		if (plugin === undefined) throw new Error("cursor has no plugin");
		const w = workspace();
		const ctx = await install(w);
		expect((await plugin.startSession(ctx, guiEnv(w))).ok).toBe(true);
		const harmless = await shell(w, "echo hello");
		expect(harmless.map((a) => a.permission)).toEqual(["allow"]);
		const wipe = await shell(w, "rm -rf ~/.cursor");
		expect(wipe.map((a) => a.permission)).toEqual(["deny"]);
	}, 90_000);

	test("uninstall leaves no trace", async () => {
		if (plugin === undefined) throw new Error("cursor has no plugin");
		const w = workspace();
		const ctx: PathCtx = { home: w.home, cwd: w.cwd };
		// A Cursor user with their own config, before they install.
		for (const seed of seedsFor("cursor", ctx)) {
			await Bun.write(seed.path, seed.content);
		}
		const before = snapshot(w.root);

		await install(w);
		const env = guiEnv(w);
		expect((await plugin.startSession(ctx, env)).ok).toBe(true);
		const launch = resolveLaunch("cursor", ctx, readOrNull);
		if (!launch.ok) throw new Error(launch.error.message);
		expect((await probeLaunch(launch.value, env, w.cwd)).toolCallOk).toBe(true);
		await write(w, join(w.cwd, "notes.md"));

		// The runtime the hooks started is running, claimed in the plugin's
		// data dir, listening where its command line says.
		const runDir = join(launch.value.env.PLUGIN_DATA ?? "", "run");
		expect(await waitFor(() => runtimePid(runDir) !== null, 10_000)).toBe(true);
		const pid = runtimePid(runDir) ?? 0;
		const socket = runtimeAddress(pid);
		expect(socket).toBeDefined();
		expect(
			await waitFor(() => socket !== undefined && existsSync(socket), 10_000),
		).toBe(true);

		expect(pluginUninstall(w.home, CURSOR_PLUGIN, readOrNull).ok).toBe(true);

		// No maina process outlives the plugin.
		expect(await waitFor(() => !alive(pid), 15_000)).toBe(true);
		// Nor its socket, wherever it had to live.
		expect(socket !== undefined && existsSync(socket)).toBe(false);
		expect(socket !== undefined && existsSync(dirname(socket))).toBe(false);
		// Every file is as it was, but for Cursor's own (now empty) plugin
		// dirs.
		expect(checkSeeds("cursor", ctx, readOrNull).ok).toBe(true);
		expect(traces(before, snapshot(w.root), BOOKKEEPING)).toEqual([]);
	}, 120_000);
});
