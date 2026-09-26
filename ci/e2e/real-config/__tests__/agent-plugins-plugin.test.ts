/**
 * The Agent Plugins 1.0 package, read by VS Code agent mode and Copilot
 * (v1 task 9.5, spec §5): a smoke install against a client that does what
 * the specification requires of one (`../hosts/agent-plugins.ts`), from a
 * local release of this checkout (`../plugin-release.ts`).
 *
 *   - a 1.0 client loads the package: both files select the 1.0 schemas and
 *     every skill is discovered from its fixed location
 *   - install from a directory on a clean machine → the MCP server starts as
 *     the spec launches it (plugin root as its working directory,
 *     `PLUGIN_ROOT`, `PLUGIN_DATA`, GUI PATH) and the first `verify`, on the
 *     workspace the client names as its MCP root, answers within 60 s
 *   - uninstall leaves no trace
 *
 * The Agent Plugins core defines no hooks, so there is no gate case: the
 * gate reaches these clients through the skills and the MCP tools only.
 * A smoke install in VS Code itself is manual (see the VS Code docs page).
 *
 * Runs in the `agent-plugins` job of the e2e workflow (and locally when no
 * cell filter is set).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { currentOs, hostEnv } from "../env";
import {
	AGENT_PLUGINS_SOURCE,
	CLIENT_BOOKKEEPING,
	installFromDirectory,
	loadPlugin,
	MCP_SCHEMA_ID,
	PLUGIN_SCHEMA_ID,
	stdioLaunch,
	uninstallPlugin,
} from "../hosts/agent-plugins";
import { createWorkspace, probeLaunch, type Workspace } from "../matrix";
import {
	type PluginRelease,
	pluginRelease,
	stopPluginRelease,
} from "../plugin-release";
import {
	alive,
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
	(cellHost === undefined || cellHost === "agent-plugins");

/** Install → first verify, the budget every host's plugin meets (#341). */
const FIRST_VERIFY_BUDGET_MS = 60_000;

/** The skills the package ships (the plugin definition's, task 9.6). */
const SKILLS = ["gate", "graph", "spec", "triage", "verify"];

describe.skipIf(!runsHere)("Agent Plugins package (#344)", () => {
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

	const source = () => join(release.marketplace, AGENT_PLUGINS_SOURCE);

	/** The workspace as an editor names it in `roots/list`. */
	const rootsOf = (w: Workspace) => [pathToFileURL(w.cwd).href];

	test("a 1.0 client loads the package: both files select the 1.0 schemas and every skill is discovered", () => {
		const loaded = loadPlugin(source());
		if (!loaded.ok) throw new Error(loaded.error);
		const plugin = loaded.value;
		expect(plugin.manifest.$schema).toBe(PLUGIN_SCHEMA_ID);
		expect(plugin.manifest.name).toBe("maina");
		expect(plugin.manifest.version).toBe(release.version);
		expect(plugin.mcpSchema).toBe(MCP_SCHEMA_ID);
		expect([...plugin.skills].sort()).toEqual(SKILLS);
		// One stdio server, the launcher named from the plugin root.
		expect(Object.keys(plugin.servers)).toEqual(["maina"]);
		expect(plugin.servers.maina).toEqual({
			type: "stdio",
			command: "./launcher/launch.sh",
			args: ["mcp"],
		});
	});

	test("install from a directory on a clean machine: the MCP server starts as the spec launches it and the first verify answers within 60 s", async () => {
		const w = workspace();
		const env = guiEnv(w);
		const t0 = performance.now();
		const installed = installFromDirectory(w.home, source());
		if (!installed.ok) throw new Error(installed.error);
		const { root, dataDir } = installed.value;

		const launch = stdioLaunch(installed.value, "maina");
		if (!launch.ok) throw new Error(launch.error);
		// The spec's launch: the command resolved against the plugin root,
		// which is also the working directory, and both variables set.
		expect(launch.value.cwd).toBe(root);
		expect(launch.value.spec.command).toBe(join(root, "launcher", "launch.sh"));
		expect(launch.value.spec.args).toEqual(["mcp"]);
		expect(launch.value.spec.env).toEqual({
			PLUGIN_ROOT: root,
			PLUGIN_DATA: dataDir,
		});

		const verified = await probeLaunch(
			launch.value.spec,
			env,
			launch.value.cwd,
			{
				coldStartBudgetMs: FIRST_VERIFY_BUDGET_MS,
				roots: rootsOf(w),
			},
		);
		const elapsedMs = performance.now() - t0;
		expect(verified.error).toBeUndefined();
		expect(verified.started).toBe(true);
		expect(verified.toolCallOk).toBe(true);
		expect(elapsedMs).toBeLessThanOrEqual(FIRST_VERIFY_BUDGET_MS);
		expect(release.downloads().length).toBeGreaterThan(0);
		// The runtime lives in the client's data dir for the plugin.
		expect(existsSync(join(dataDir, "runtime"))).toBe(true);
		expect(existsSync(join(w.home, ".maina", "runtime"))).toBe(false);
	}, 90_000);

	test("without MCP roots, a server started in the plugin root refuses to guess a project", async () => {
		const w = workspace();
		const installed = installFromDirectory(w.home, source());
		if (!installed.ok) throw new Error(installed.error);
		const launch = stdioLaunch(installed.value, "maina");
		if (!launch.ok) throw new Error(launch.error);
		const probed = await probeLaunch(
			launch.value.spec,
			guiEnv(w),
			launch.value.cwd,
			{ coldStartBudgetMs: FIRST_VERIFY_BUDGET_MS },
		);
		expect(probed.started).toBe(true);
		expect(probed.toolCallOk).toBe(false);
		expect(probed.error?.message).toContain("no_root");
	}, 90_000);

	test("uninstall leaves no trace", async () => {
		const w = workspace();
		const before = snapshot(w.root);
		const installed = installFromDirectory(w.home, source());
		if (!installed.ok) throw new Error(installed.error);
		const launch = stdioLaunch(installed.value, "maina");
		if (!launch.ok) throw new Error(launch.error);
		const probed = await probeLaunch(
			launch.value.spec,
			guiEnv(w),
			launch.value.cwd,
			{ roots: rootsOf(w) },
		);
		expect(probed.toolCallOk).toBe(true);
		const pid = runtimePid(join(installed.value.dataDir, "run"));

		expect(
			uninstallPlugin(w.home, installed.value.plugin.manifest.name),
		).toEqual({ ok: true, value: undefined });

		// No maina process outlives the plugin, if the server started one.
		if (pid !== null) {
			expect(await waitFor(() => !alive(pid), 15_000)).toBe(true);
		}
		expect(traces(before, snapshot(w.root), CLIENT_BOOKKEEPING)).toEqual([]);
	}, 120_000);
});
