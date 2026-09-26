/**
 * Cursor reads MCP servers from `<cwd>/.cursor/mcp.json` (project) and
 * `~/.cursor/mcp.json` (global); the project file wins. An installed
 * plugin's own `mcp.json` comes last.
 *
 * The plugin install path (#342), per https://cursor.com/docs/plugins and
 * https://cursor.com/docs/reference/plugins:
 *
 *   <repo>/.cursor-plugin/marketplace.json   what a Team Marketplace import
 *                                            (and the Cursor Marketplace)
 *                                            reads; each entry's `source` is
 *                                            the plugin's folder
 *   ~/.cursor/plugins/                       installed plugins
 *   ~/.cursor/plugins/local/<name>/          where Cursor documents it loads
 *                                            a plugin from on disk
 *
 * Cursor does not document the folder a marketplace install lands in, so
 * the install copies the listed plugin to `plugins/local/<name>`, the
 * documented one: nothing in the plugin depends on where its root is.
 *
 * At session start Cursor runs a plugin's hooks from the plugin root (its
 * `hooks.json` commands are relative to it), with the workspace in
 * `CURSOR_PROJECT_DIR` (and `CLAUDE_PROJECT_DIR`) and the event's JSON on
 * stdin. It expands `${CURSOR_PLUGIN_ROOT}` (and `${CLAUDE_PLUGIN_ROOT}`) to
 * the plugin root in an MCP server's command, args, env values and cwd; it
 * exports no plugin variable to either process.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type HookRun, runHookCommand } from "../hook-process";
import type {
	CaseError,
	ConfigSource,
	Env,
	HostSpec,
	PathCtx,
	ReadFile,
	Result,
} from "../types";
import { ONBOARDING } from "./claude-code";
import { at } from "./select";

// ── Plugin file contract ───────────────────────────────────────────────────

/** Where a marketplace lists its plugins, from its root. */
const MARKETPLACE_FILE = join(".cursor-plugin", "marketplace.json");

/** The plugin the install path installs, from the repo's marketplace. */
export const CURSOR_PLUGIN = "maina";

export interface InstalledPlugin {
	readonly name: string;
	/** The plugin root: `${CURSOR_PLUGIN_ROOT}`. */
	readonly root: string;
}

type Json = Record<string, unknown>;

const pluginsDir = (home: string): string => join(home, ".cursor", "plugins");
const localDir = (home: string): string => join(pluginsDir(home), "local");

const parse = (raw: string | null): Json | undefined => {
	if (raw === null) return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Json)
			: undefined;
	} catch {
		return undefined;
	}
};

const readJson = (path: string, readFile: ReadFile): Json | undefined =>
	parse(readFile(path));

/** The real file system, as Cursor reads it. */
const readFileOrNull: ReadFile = (path) => {
	try {
		return existsSync(path) ? readFileSync(path, "utf-8") : null;
	} catch {
		return null;
	}
};

const inside = (root: string, path: string): boolean => {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
};

/**
 * The installed plugins that could provide maina: the local plugin named
 * `maina`, when its folder holds a Cursor plugin manifest with that name.
 * (A `ReadFile` cannot list folders, and no other plugin is maina's.)
 */
export function installedPlugins(
	home: string,
	readFile: ReadFile,
): readonly InstalledPlugin[] {
	const root = join(localDir(home), CURSOR_PLUGIN);
	const manifest = readJson(
		join(root, ".cursor-plugin", "plugin.json"),
		readFile,
	);
	return manifest?.name === CURSOR_PLUGIN
		? [{ name: CURSOR_PLUGIN, root }]
		: [];
}

const expand = (value: string, root: string): string =>
	value.replace(/\$\{(CURSOR_PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}/g, () => root);

/** `value` with every string (deeply) expanded. */
function expandAll(value: unknown, root: string): unknown {
	if (typeof value === "string") return expand(value, root);
	if (Array.isArray(value)) return value.map((v) => expandAll(v, root));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, expandAll(v, root)]),
		);
	}
	return value;
}

/** Each installed plugin's `mcp.json`, lowest precedence. */
function pluginMcpSources(
	home: string,
	readFile: ReadFile,
): readonly ConfigSource[] {
	return installedPlugins(home, readFile).map((plugin) => ({
		path: join(plugin.root, "mcp.json"),
		format: "json",
		select: (parsed) => {
			const entry = at(parsed, ["mcpServers", "maina"]);
			return entry === undefined ? undefined : expandAll(entry, plugin.root);
		},
	}));
}

export interface PluginHook {
	readonly plugin: InstalledPlugin;
	readonly command: string;
	readonly failClosed: boolean;
}

/** The installed plugins' hook commands for `event`, in registration order. */
export function pluginHooks(
	home: string,
	readFile: ReadFile,
	event: string,
): readonly PluginHook[] {
	return installedPlugins(home, readFile).flatMap((plugin) => {
		const entries = at(
			readJson(join(plugin.root, "hooks", "hooks.json"), readFile),
			["hooks", event],
		);
		if (!Array.isArray(entries)) return [];
		return (entries as Json[])
			.filter((e) => typeof e.command === "string")
			.map((e) => ({
				plugin,
				command: e.command as string,
				failClosed: e.failClosed === true,
			}));
	});
}

/** What Cursor gives a hook process: the workspace, and its version. */
export function hookEnv(env: Env, projectDir: string): Env {
	return {
		...env,
		CURSOR_PROJECT_DIR: projectDir,
		CLAUDE_PROJECT_DIR: projectDir,
		CURSOR_VERSION: CURSOR_VERSION,
	};
}

/** One plugin hook, as Cursor runs it: from the plugin root. */
export function runPluginHook(
	hook: PluginHook,
	input: unknown,
	env: Env,
	projectDir: string,
): Promise<HookRun> {
	return runHookCommand(
		hook.command,
		input,
		hookEnv(env, projectDir),
		hook.plugin.root,
	);
}

type Fail = Result<never, string>;
const fail = (error: string): Fail => ({ ok: false, error });

/** The folder a marketplace entry's `source` names, inside the marketplace. */
function entrySource(marketplace: string, entry: Json): Result<string, string> {
	const source = entry.source;
	const path =
		typeof source === "string"
			? source
			: typeof (source as Json | undefined)?.path === "string"
				? ((source as Json).path as string)
				: undefined;
	if (path === undefined) {
		return fail(`unsupported source ${JSON.stringify(source)}`);
	}
	const from = resolve(marketplace, path);
	return inside(marketplace, from)
		? { ok: true, value: from }
		: fail(`source ${path} leaves the marketplace`);
}

/**
 * A Team Marketplace import of `marketplace` (a repo checkout) and an
 * install of `name` from it: the listed plugin, copied to where Cursor
 * loads it.
 */
export function pluginInstall(
	home: string,
	marketplace: string,
	name: string,
	readFile: ReadFile,
): Result<InstalledPlugin, string> {
	const listing = readJson(join(marketplace, MARKETPLACE_FILE), readFile);
	if (typeof listing?.name !== "string" || !Array.isArray(listing.plugins)) {
		return fail(`${marketplace} has no valid ${MARKETPLACE_FILE}`);
	}
	const entry = (listing.plugins as Json[]).find((p) => p.name === name);
	if (entry === undefined) return fail(`${listing.name} lists no ${name}`);
	const from = entrySource(marketplace, entry);
	if (!from.ok) return fail(`${name}: ${from.error}`);
	const manifest = readJson(
		join(from.value, ".cursor-plugin", "plugin.json"),
		readFile,
	);
	if (manifest?.name !== name) {
		return fail(`${name}: no .cursor-plugin/plugin.json named ${name}`);
	}
	const root = join(localDir(home), name);
	mkdirSync(dirname(root), { recursive: true });
	cpSync(from.value, root, { recursive: true });
	return { ok: true, value: { name, root } };
}

/** Removes `dir`'s empty parents up to (not including) `stop`. */
function pruneEmpty(dir: string, stop: string): void {
	let cursor = dir;
	while (inside(stop, cursor) && cursor !== stop) {
		try {
			if (readdirSync(cursor).length > 0) return;
			rmdirSync(cursor);
		} catch {
			return;
		}
		cursor = dirname(cursor);
	}
}

/** Uninstalling a plugin: its folder goes, with everything in it. */
export function pluginUninstall(
	home: string,
	name: string,
	readFile: ReadFile,
): Result<void, string> {
	const plugin = installedPlugins(home, readFile).find((p) => p.name === name);
	if (plugin === undefined) return fail(`${name} is not installed`);
	rmSync(plugin.root, { recursive: true, force: true });
	pruneEmpty(dirname(plugin.root), pluginsDir(home));
	return { ok: true, value: undefined };
}

// ── Hook payloads (https://cursor.com/docs/hooks) ──────────────────────────

const CONVERSATION_ID = "e2e-real-config-conversation";
const CURSOR_VERSION = "1.7.2";

const common = (cwd: string, event: string) => ({
	conversation_id: CONVERSATION_ID,
	generation_id: "e2e-real-config-generation",
	model: "e2e",
	hook_event_name: event,
	cursor_version: CURSOR_VERSION,
	workspace_roots: [cwd],
	user_email: null,
	transcript_path: null,
});

export const sessionStartInput = (cwd: string) => ({
	...common(cwd, "sessionStart"),
	session_id: CONVERSATION_ID,
	is_background_agent: false,
	composer_mode: "agent",
});

export const writeInput = (cwd: string, filePath: string, content: string) => ({
	...common(cwd, "preToolUse"),
	tool_name: "Write",
	tool_input: { file_path: filePath, content },
	tool_use_id: "e2e-tool-use",
	cwd,
});

export const shellInput = (cwd: string, command: string) => ({
	...common(cwd, "beforeShellExecution"),
	command,
	cwd,
	sandbox: false,
});

/** The first session's sessionStart hooks, as Cursor runs them. */
async function startSession(
	{ home, cwd }: PathCtx,
	env: Env,
	readFile: ReadFile,
): Promise<Result<string, CaseError>> {
	const failed = (message: string): Result<string, CaseError> => ({
		ok: false,
		error: { kind: "session-start-failed", message },
	});
	const hooks = pluginHooks(home, readFile, "sessionStart");
	if (hooks.length === 0)
		return failed("no installed plugin hooks sessionStart");
	const contexts: string[] = [];
	for (const hook of hooks) {
		const run = await runPluginHook(hook, sessionStartInput(cwd), env, cwd);
		const context = at(parse(run.stdout.trim()), ["additional_context"]);
		if (run.exitCode !== 0 || typeof context !== "string") {
			return failed(
				`sessionStart hook exited ${run.exitCode}: ${run.stdout}${run.stderr}`.slice(
					0,
					2_000,
				),
			);
		}
		contexts.push(context);
	}
	const context = contexts.join("\n");
	return context.includes(ONBOARDING)
		? { ok: true, value: context }
		: failed(`sessionStart did not onboard: ${context}`);
}

// ── Host spec ──────────────────────────────────────────────────────────────

export const cursor: HostSpec = {
	id: "cursor",
	mcpAddClient: "cursor",
	seeds: ({ home }) => [
		{
			path: join(home, ".cursor", "mcp.json"),
			format: "json",
			content: `${JSON.stringify(
				{ mcpServers: { memory: { command: "memory-server" } } },
				null,
				2,
			)}\n`,
			intact: (parsed) =>
				at(parsed, ["mcpServers", "memory", "command"]) === "memory-server",
		},
	],
	configSources: ({ home, cwd }, read) => [
		{
			path: join(cwd, ".cursor", "mcp.json"),
			format: "json",
			select: (parsed) => at(parsed, ["mcpServers", "maina"]),
		},
		{
			path: join(home, ".cursor", "mcp.json"),
			format: "json",
			select: (parsed) => at(parsed, ["mcpServers", "maina"]),
		},
		...pluginMcpSources(home, read),
	],
	strayPaths: ({ cwd }) => [join(cwd, ".mcp.json")],
	plugin: {
		install: ({ home }, source) => {
			const installed = pluginInstall(
				home,
				source,
				CURSOR_PLUGIN,
				readFileOrNull,
			);
			return installed.ok
				? { ok: true, value: undefined }
				: {
						ok: false,
						error: {
							kind: "installer-failed",
							message: installed.error,
							exitCode: 1,
						},
					};
		},
		startSession: (ctx, env) => startSession(ctx, env, readFileOrNull),
	},
};
