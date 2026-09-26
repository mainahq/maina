/**
 * The Codex plugin install path (v1 task 9.4, spec §5, G1): the same cases
 * as the Claude Code plugin (#341), for Codex, plus its command policy.
 *
 * A user installs maina from the repo's marketplace
 * (`.agents/plugins/marketplace.json`) with `/plugins`. This does what
 * Codex does on disk (see `../hosts/codex.ts`), from a local release of
 * this checkout (`../plugin-release.ts`), then runs the plugin the way a
 * session does: its hooks through the shell with `PLUGIN_ROOT` and
 * `PLUGIN_DATA`, its MCP server from its `mcp.json`, with the GUI-launched
 * env (no bun, no node on PATH).
 *
 *   - install on a clean machine → the first `SessionStart` onboards and
 *     the first `verify` answers, all within 60 s
 *   - a destructive fixture command is denied
 *   - the plugin's rules file (task 4.5) loads once the project is trusted,
 *     and Codex then forbids the agent's own gate override itself
 *   - uninstall leaves no trace: no file, no running runtime, no socket
 *
 * Runs in the codex `plugin` cell of the e2e workflow (and locally when no
 * cell filter is set).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentOs, hostEnv } from "../env";
import { runHookCommand } from "../hook-process";
import { ONBOARDING } from "../hosts/claude-code";
import {
	addFilePatch,
	applyPatchInput,
	bashInput,
	CODEX_PLUGIN,
	codex,
	execPolicy,
	hookEnv,
	installedPlugins,
	loadedRules,
	pluginHooks,
	pluginUninstall,
	trustProject,
} from "../hosts/codex";
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
	(cellHost === undefined || cellHost === "codex");

/** Install → first onboarding + first verify (issue #341, same for #343). */
const FIRST_VERIFY_BUDGET_MS = 60_000;

const readOrNull = (path: string): string | null => {
	try {
		return existsSync(path) ? readFileSync(path, "utf-8") : null;
	} catch {
		return null;
	}
};

const listDir = (dir: string): readonly string[] => {
	try {
		return existsSync(dir) ? readdirSync(dir) : [];
	} catch {
		return [];
	}
};

const plugin = codex.plugin;

/**
 * Codex's own plugin dirs, which it keeps once the last plugin is gone.
 * Its `config.toml` must come back byte for byte, so it is not listed.
 */
const BOOKKEEPING: Bookkeeping = {
	dirs: new Set([
		"home/.codex/plugins",
		"home/.codex/plugins/cache",
		"home/.codex/plugins/data",
	]),
	files: new Set(),
};

type Answer = Readonly<{
	exitCode: number | null;
	permissionDecision?: string;
}>;

describe.skipIf(!runsHere)("Codex plugin (#343)", () => {
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
	const preToolUse = async (
		w: Workspace,
		tool: string,
		input: unknown,
	): Promise<readonly Answer[]> => {
		const hooks = pluginHooks(w.home, readOrNull, "PreToolUse", tool);
		expect(hooks.length).toBeGreaterThan(0);
		return Promise.all(
			hooks.map(async (hook) => {
				const run = await runHookCommand(
					hook.command,
					input,
					hookEnv(guiEnv(w), hook.plugin),
					w.cwd,
				);
				const out = JSON.parse(run.stdout.trim() || "{}") as {
					hookSpecificOutput?: { permissionDecision?: string };
				};
				return {
					exitCode: run.exitCode,
					permissionDecision: out.hookSpecificOutput?.permissionDecision,
				};
			}),
		);
	};

	const bash = (w: Workspace, command: string) =>
		preToolUse(w, "Bash", bashInput(w.cwd, command));

	const patch = (w: Workspace, path: string) =>
		preToolUse(
			w,
			"apply_patch",
			applyPatchInput(w.cwd, addFilePatch(path, "{}")),
		);

	const install = async (w: Workspace): Promise<PathCtx> => {
		if (plugin === undefined) throw new Error("codex has no plugin");
		const ctx: PathCtx = { home: w.home, cwd: w.cwd };
		const installed = plugin.install(ctx, release.marketplace);
		expect(installed).toEqual({ ok: true, value: undefined });
		return ctx;
	};

	test("marketplace install on a clean machine: the first SessionStart onboards and the first verify answers within 60 s", async () => {
		if (plugin === undefined) throw new Error("codex has no plugin");
		const w = workspace();
		const env = guiEnv(w);
		const t0 = performance.now();
		const ctx = await install(w);

		const session = await plugin.startSession(ctx, env);
		expect(session.ok).toBe(true);
		if (session.ok) expect(session.value).toContain(ONBOARDING);

		const launch = resolveLaunch("codex", ctx, readOrNull);
		expect(launch.ok).toBe(true);
		if (!launch.ok) return;
		const [installed] = installedPlugins(w.home, readOrNull);
		expect(installed?.key).toBe(CODEX_PLUGIN);
		expect(launch.value.source).toBe(join(installed?.root ?? "", "mcp.json"));
		// The runtime lives in the plugin's data dir, not in ~/.maina.
		expect(launch.value.env.PLUGIN_DATA).toBe(installed?.data ?? "");
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
		if (plugin === undefined) throw new Error("codex has no plugin");
		const w = workspace();
		const ctx = await install(w);
		expect((await plugin.startSession(ctx, guiEnv(w))).ok).toBe(true);

		// The gate is live, not the launcher's fail-closed answer: a harmless
		// patch in the project is allowed (`{}`, exit 0: Codex's own
		// approval stands).
		const harmless = await patch(w, join(w.cwd, "notes.md"));
		expect(harmless).toEqual([{ exitCode: 0, permissionDecision: undefined }]);

		// Overwriting the user's Codex hooks (where maina's own could be
		// switched off) is denied outright, exit 2. Codex does not enforce a
		// PreToolUse deny for apply_patch yet (openai/codex#27833); the
		// answer is still a deny.
		const wipe = await patch(w, join(w.home, ".codex", "hooks.json"));
		expect(wipe).toEqual([{ exitCode: 2, permissionDecision: "deny" }]);

		// Codex runs a tool whose hook asks, so an irreversible command the
		// user may still approve is a deny that says so: never an allow.
		const rootWipe = await bash(w, "rm -rf /");
		expect(rootWipe).toEqual([{ exitCode: 2, permissionDecision: "deny" }]);
	}, 90_000);

	// #526: the standalone runtime cannot load tree-sitter, so every shell
	// command is `shell.opaque` (ask, which Codex gets as a deny). When that
	// is fixed this starts passing, `test.failing` goes red: make it a
	// plain `test`.
	test.failing("Bash commands are classified in the standalone runtime (#526)", async () => {
		if (plugin === undefined) throw new Error("codex has no plugin");
		const w = workspace();
		const ctx = await install(w);
		expect((await plugin.startSession(ctx, guiEnv(w))).ok).toBe(true);
		const harmless = await bash(w, "echo hello");
		expect(harmless).toEqual([{ exitCode: 0, permissionDecision: undefined }]);
	}, 90_000);

	test("the plugin's rules file loads in a trusted project, and Codex forbids the agent's own gate override", async () => {
		const w = workspace();
		const ctx = await install(w);
		const [installed] = installedPlugins(w.home, readOrNull);
		const rulesFile = join(installed?.root ?? "", "rules", "maina.rules");
		expect(existsSync(rulesFile)).toBe(true);
		const texts = () =>
			loadedRules(ctx, readOrNull, listDir).map(
				(path) => readOrNull(path) ?? "",
			);
		const override = ["maina", "allow", "d-7", "--always"];

		// Codex keeps a plugin's command policy off until the user trusts
		// the project.
		expect(loadedRules(ctx, readOrNull, listDir)).not.toContain(rulesFile);
		expect(execPolicy(texts(), override)).toBeUndefined();

		trustProject(w.home, w.cwd);
		expect(loadedRules(ctx, readOrNull, listDir)).toContain(rulesFile);
		expect(execPolicy(texts(), override)).toBe("forbidden");
		// However a package runner names it.
		expect(execPolicy(texts(), ["bunx", "maina", ...override.slice(1)])).toBe(
			"forbidden",
		);
		expect(
			execPolicy(texts(), ["npx", "@mainahq/cli", ...override.slice(1)]),
		).toBe("forbidden");
		// Nothing else is forbidden, or allowed past the hook.
		expect(execPolicy(texts(), ["bun", "test"])).toBeUndefined();
		expect(execPolicy(texts(), ["maina", "verify"])).toBeUndefined();
	}, 90_000);

	test("uninstall leaves no trace", async () => {
		if (plugin === undefined) throw new Error("codex has no plugin");
		const w = workspace();
		const ctx: PathCtx = { home: w.home, cwd: w.cwd };
		// A Codex user with their own config, before they install.
		for (const seed of seedsFor("codex", ctx)) {
			await Bun.write(seed.path, seed.content);
		}
		const before = snapshot(w.root);

		await install(w);
		const [installed] = installedPlugins(w.home, readOrNull);
		if (installed === undefined) throw new Error("plugin not enabled");
		const env = guiEnv(w);
		expect((await plugin.startSession(ctx, env)).ok).toBe(true);
		const launch = resolveLaunch("codex", ctx, readOrNull);
		if (!launch.ok) throw new Error(launch.error.message);
		expect((await probeLaunch(launch.value, env, w.cwd)).toolCallOk).toBe(true);
		await patch(w, join(w.cwd, "notes.md"));

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

		expect(pluginUninstall(w.home, CODEX_PLUGIN, readOrNull).ok).toBe(true);

		// No maina process outlives the plugin.
		expect(await waitFor(() => !alive(pid), 15_000)).toBe(true);
		// Nor its socket, wherever it had to live.
		expect(socket !== undefined && existsSync(socket)).toBe(false);
		expect(socket !== undefined && existsSync(dirname(socket))).toBe(false);
		// Every file is as it was (the user's config.toml byte for byte), but
		// for Codex's own (now empty) plugin dirs.
		expect(checkSeeds("codex", ctx, readOrNull).ok).toBe(true);
		expect(traces(before, snapshot(w.root), BOOKKEEPING)).toEqual([]);
	}, 120_000);
});
