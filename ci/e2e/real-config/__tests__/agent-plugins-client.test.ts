/**
 * The Agent Plugins 1.0 client model (`../hosts/agent-plugins.ts`) holds
 * the package to what the specification requires of a client, so the smoke
 * install cannot pass on a launch a real client would refuse or run
 * differently: schema selection by `$schema`, fixed component locations,
 * plugin-relative commands kept inside the plugin root, and the one
 * placeholder expansion the spec defines.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type InstalledPlugin,
	loadPlugin,
	MCP_SCHEMA_ID,
	PLUGIN_SCHEMA_ID,
	stdioLaunch,
} from "../hosts/agent-plugins";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "maina-ap-client-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let count = 0;

/** A plugin folder with these files (content as JSON when not a string). */
function pluginDir(files: Readonly<Record<string, unknown>>): string {
	count += 1;
	const root = join(scratch, `p${count}`);
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(
			full,
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
	return root;
}

const manifest = { $schema: PLUGIN_SCHEMA_ID, name: "demo" };
const mcp = (server: Record<string, unknown>) => ({
	$schema: MCP_SCHEMA_ID,
	mcpServers: { demo: server },
});

const installed = (root: string): InstalledPlugin => {
	const loaded = loadPlugin(root);
	if (!loaded.ok) throw new Error(loaded.error);
	return { root, dataDir: join(scratch, "data"), plugin: loaded.value };
};

describe("loadPlugin", () => {
	test("selects plugin.json and mcp.json by their declared 1.0 schema", () => {
		expect(
			loadPlugin(pluginDir({ "plugin.json": { ...manifest, $schema: "x" } }))
				.ok,
		).toBe(false);
		expect(
			loadPlugin(
				pluginDir({
					"plugin.json": manifest,
					"mcp.json": { mcpServers: {} },
				}),
			).ok,
		).toBe(false);
		expect(loadPlugin(pluginDir({ "plugin.json": manifest })).ok).toBe(true);
	});

	test("refuses a name the 1.0 manifest schema refuses", () => {
		for (const name of ["Maina", "a--b", "-a", "a..b", ""]) {
			expect(
				loadPlugin(pluginDir({ "plugin.json": { ...manifest, name } })).ok,
			).toBe(false);
		}
	});

	test("discovers skills only as immediate folders of skills/ holding SKILL.md", () => {
		const loaded = loadPlugin(
			pluginDir({
				"plugin.json": manifest,
				"skills/a/SKILL.md": "---\nname: a\n---\n",
				"skills/b/README.md": "no skill here",
				"skills/c/deep/SKILL.md": "---\nname: deep\n---\n",
			}),
		);
		expect(loaded.ok && loaded.value.skills).toEqual(["a"]);
	});
});

describe("stdioLaunch", () => {
	test("a ./ command resolves against the plugin root, which is also the working directory", () => {
		const root = pluginDir({
			"plugin.json": manifest,
			"mcp.json": mcp({ type: "stdio", command: "./bin/run.sh", args: ["x"] }),
			"bin/run.sh": "#!/bin/sh\n",
		});
		chmodSync(join(root, "bin", "run.sh"), 0o755);
		const launch = stdioLaunch(installed(root), "demo");
		expect(launch.ok && launch.value.spec.command).toBe(
			join(root, "bin", "run.sh"),
		);
		expect(launch.ok && launch.value.cwd).toBe(root);
	});

	test("refuses a command that leaves the plugin root", () => {
		const root = pluginDir({
			"plugin.json": manifest,
			"mcp.json": mcp({ type: "stdio", command: "./../outside.sh" }),
		});
		writeFileSync(join(root, "..", "outside.sh"), "#!/bin/sh\n");
		const launch = stdioLaunch(installed(root), "demo");
		expect(launch.ok).toBe(false);
	});

	test("never expands a placeholder in command: a command neither bare nor ./ is refused", () => {
		const root = pluginDir({
			"plugin.json": manifest,
			"mcp.json": mcp({ type: "stdio", command: "${PLUGIN_ROOT}/run.sh" }),
			"run.sh": "#!/bin/sh\n",
		});
		expect(stdioLaunch(installed(root), "demo").ok).toBe(false);
	});

	test("expands PLUGIN_ROOT and PLUGIN_DATA once, in args, env and cwd", () => {
		const root = pluginDir({
			"plugin.json": manifest,
			"mcp.json": mcp({
				type: "stdio",
				command: "node",
				args: ["${PLUGIN_DATA}/state", "${HOME}"],
				env: { CACHE: "${PLUGIN_DATA}/cache" },
				cwd: "${PLUGIN_DATA}",
			}),
		});
		const plugin = installed(root);
		const launch = stdioLaunch(plugin, "demo");
		if (!launch.ok) throw new Error(launch.error);
		// A bare command stays a PATH lookup.
		expect(launch.value.spec.command).toBe("node");
		expect(launch.value.spec.args).toEqual([
			`${plugin.dataDir}/state`,
			"${HOME}",
		]);
		expect(launch.value.spec.env).toEqual({
			CACHE: `${plugin.dataDir}/cache`,
			PLUGIN_ROOT: root,
			PLUGIN_DATA: plugin.dataDir,
		});
		expect(launch.value.cwd).toBe(plugin.dataDir);
	});

	test("refuses an env that sets PLUGIN_ROOT or PLUGIN_DATA itself", () => {
		const root = pluginDir({
			"plugin.json": manifest,
			"mcp.json": mcp({
				type: "stdio",
				command: "node",
				env: { PLUGIN_DATA: "/tmp/elsewhere" },
			}),
		});
		expect(stdioLaunch(installed(root), "demo").ok).toBe(false);
	});
});
