/**
 * An Agent Plugins 1.0 client (https://agent-plugins.org/specification),
 * modelled for the smoke install of maina's Agent Plugins package (v1 task
 * 9.5), which VS Code agent mode and Copilot read. It does what §11.1
 * requires of a client, no more:
 *
 *   - load a plugin from a directory; select `plugin.json` and `mcp.json`
 *     by their declared `$schema` and refuse any other schema
 *   - discover skills only at their fixed location: each immediate folder
 *     of `skills/` holding a regular `SKILL.md`
 *   - launch a stdio server with `command` as one token: a bare name is a
 *     PATH lookup, a `./` path resolves against the plugin root and must
 *     stay inside it; anything else is refused (no placeholder is expanded
 *     in `command`)
 *   - run it in the plugin root unless `cwd` says otherwise, with
 *     `PLUGIN_ROOT` and `PLUGIN_DATA` in its environment, and expand those
 *     two placeholders once, textually, in `args`, `env` values and `cwd`
 *
 * Full JSON Schema validation of both files is `packages/plugins`'
 * (`generate.test.ts`); this checks what a client needs to select and run
 * them.
 *
 * Modelled, not observed: the spec leaves where a client keeps installed
 * plugins and their data dirs to the client, so this one keeps them under
 * `~/.agent-plugins/{plugins,data}/<name>`. VS Code's own locations are
 * checked by the manual smoke install (docs: VS Code and Copilot).
 */

import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { LaunchSpec, Result } from "../types";
import type { Bookkeeping } from "../uninstall-traces";

/** The generated package, from the repo root (no marketplace lists it). */
export const AGENT_PLUGINS_SOURCE = "./packages/plugins/dist/agent-plugins";

export const PLUGIN_SCHEMA_ID =
	"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const MCP_SCHEMA_ID =
	"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

/** The 1.0 manifest schema's `name` pattern, with its 1–64 length. */
const NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** The variables a client supplies and expands; the package may not set them. */
const RESERVED = ["PLUGIN_ROOT", "PLUGIN_DATA"] as const;

export type StdioServer = Readonly<{
	type: "stdio";
	command: string;
	args?: readonly string[];
	env?: Readonly<Record<string, string>>;
	cwd?: string;
}>;

export type LoadedPlugin = Readonly<{
	manifest: Readonly<{ $schema: string; name: string; version?: string }>;
	/** `mcp.json`'s `$schema`, when the plugin has one. */
	mcpSchema?: string;
	skills: readonly string[];
	servers: Readonly<Record<string, StdioServer>>;
}>;

export type InstalledPlugin = Readonly<{
	root: string;
	dataDir: string;
	plugin: LoadedPlugin;
}>;

/** The client's own dirs, which it keeps after the last uninstall. */
export const CLIENT_BOOKKEEPING: Bookkeeping = {
	dirs: new Set([
		"home/.agent-plugins",
		"home/.agent-plugins/plugins",
		"home/.agent-plugins/data",
	]),
	files: new Set(),
};

const pluginsDir = (home: string) => join(home, ".agent-plugins", "plugins");
const dataDirOf = (home: string, name: string) =>
	join(home, ".agent-plugins", "data", name);

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function readJson(path: string): Result<unknown, string> {
	try {
		return { ok: true, value: JSON.parse(readFileSync(path, "utf-8")) };
	} catch (e) {
		return { ok: false, error: `${path}: ${String(e)}` };
	}
}

const isFile = (path: string): boolean => {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
};

/** Immediate folders of `skills/` holding a regular `SKILL.md`. */
function discoverSkills(root: string): readonly string[] {
	const dir = join(root, "skills");
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && isFile(join(dir, e.name, "SKILL.md")))
		.map((e) => e.name)
		.sort();
}

function stdioServers(
	raw: unknown,
): Result<Readonly<Record<string, StdioServer>>, string> {
	if (!isObject(raw) || raw.$schema !== MCP_SCHEMA_ID) {
		return { ok: false, error: "mcp.json does not select the 1.0 schema" };
	}
	if (!isObject(raw.mcpServers)) {
		return { ok: false, error: "mcp.json has no mcpServers object" };
	}
	const servers: Record<string, StdioServer> = {};
	for (const [name, entry] of Object.entries(raw.mcpServers)) {
		// This client runs stdio servers only, which §11.1 allows.
		if (!isObject(entry) || entry.type !== "stdio") continue;
		if (typeof entry.command !== "string" || entry.command === "") {
			return { ok: false, error: `mcp.json: ${name} has no command` };
		}
		servers[name] = entry as unknown as StdioServer;
	}
	return { ok: true, value: servers };
}

export function loadPlugin(root: string): Result<LoadedPlugin, string> {
	const manifest = readJson(join(root, "plugin.json"));
	if (!manifest.ok) return manifest;
	const m = manifest.value;
	if (!isObject(m) || m.$schema !== PLUGIN_SCHEMA_ID) {
		return { ok: false, error: "plugin.json does not select the 1.0 schema" };
	}
	if (typeof m.name !== "string" || m.name.length > 64 || !NAME.test(m.name)) {
		return { ok: false, error: `plugin.json: invalid name ${String(m.name)}` };
	}
	const mcpPath = join(root, "mcp.json");
	let servers: Readonly<Record<string, StdioServer>> = {};
	let mcpSchema: string | undefined;
	if (existsSync(mcpPath)) {
		const raw = readJson(mcpPath);
		if (!raw.ok) return raw;
		const parsed = stdioServers(raw.value);
		if (!parsed.ok) return parsed;
		servers = parsed.value;
		mcpSchema = MCP_SCHEMA_ID;
	}
	return {
		ok: true,
		value: {
			manifest: m as LoadedPlugin["manifest"],
			...(mcpSchema !== undefined ? { mcpSchema } : {}),
			skills: discoverSkills(root),
			servers,
		},
	};
}

/** Whether `path`, symlinks resolved, is `root` or inside it. */
function within(root: string, path: string): boolean {
	try {
		const rel = relative(realpathSync(root), realpathSync(path));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	} catch {
		return false;
	}
}

/** Copy a plugin folder into the client's plugin dir, as installing does. */
export function installFromDirectory(
	home: string,
	source: string,
): Result<InstalledPlugin, string> {
	const loaded = loadPlugin(source);
	if (!loaded.ok) return loaded;
	const name = loaded.value.manifest.name;
	const root = join(pluginsDir(home), name);
	const dataDir = dataDirOf(home, name);
	try {
		mkdirSync(pluginsDir(home), { recursive: true });
		cpSync(source, root, { recursive: true });
		mkdirSync(dataDir, { recursive: true });
	} catch (e) {
		return { ok: false, error: `install ${name}: ${String(e)}` };
	}
	return { ok: true, value: { root, dataDir, plugin: loaded.value } };
}

/** Remove the plugin and its data dir, as uninstalling does. */
export function uninstallPlugin(
	home: string,
	name: string,
): Result<void, string> {
	try {
		rmSync(join(pluginsDir(home), name), { recursive: true, force: true });
		rmSync(dataDirOf(home, name), { recursive: true, force: true });
		return { ok: true, value: undefined };
	} catch (e) {
		return { ok: false, error: `uninstall ${name}: ${String(e)}` };
	}
}

/** The one expansion the spec defines: single-pass, non-recursive. */
const expand = (value: string, vars: Readonly<Record<string, string>>) =>
	value.replace(
		/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g,
		(_, key: string) => vars[key] ?? "",
	);

/** The process a 1.0 client spawns for one stdio server, and where. */
export function stdioLaunch(
	installed: InstalledPlugin,
	name: string,
): Result<Readonly<{ spec: LaunchSpec; cwd: string }>, string> {
	const { root, dataDir, plugin } = installed;
	const server = plugin.servers[name];
	if (server === undefined) return { ok: false, error: `no server ${name}` };
	const vars = { PLUGIN_ROOT: root, PLUGIN_DATA: dataDir };
	const env = server.env ?? {};
	const reserved = RESERVED.filter((key) => key in env);
	if (reserved.length > 0) {
		return { ok: false, error: `${name}: env sets ${reserved.join(", ")}` };
	}
	let command = server.command;
	if (command.startsWith("./")) {
		command = resolve(root, command);
		if (!within(root, command)) {
			return { ok: false, error: `${name}: ${server.command} leaves the root` };
		}
	} else if (/[/\\]/.test(command) || command.includes("${")) {
		return {
			ok: false,
			error: `${name}: ${server.command} is neither a bare name nor ./`,
		};
	}
	let cwd = root;
	if (server.cwd !== undefined) {
		const expanded = expand(server.cwd, vars);
		cwd = expanded.startsWith("./") ? resolve(root, expanded) : expanded;
	}
	return {
		ok: true,
		value: {
			cwd,
			spec: {
				command,
				args: (server.args ?? []).map((arg) => expand(arg, vars)),
				env: {
					...Object.fromEntries(
						Object.entries(env).map(([k, v]) => [k, expand(v, vars)]),
					),
					...vars,
				},
				source: join(root, "mcp.json"),
			},
		},
	};
}
