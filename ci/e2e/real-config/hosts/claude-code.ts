/**
 * Claude Code reads MCP servers from (highest precedence first):
 *   - local scope:   `~/.claude.json` → `projects[<cwd>].mcpServers`
 *   - project scope: `<cwd>/.mcp.json` → `mcpServers`
 *   - user scope:    `~/.claude.json` → `mcpServers`
 *   - plugins:       each enabled plugin's `<plugin root>/.mcp.json`
 *
 * It never reads `mcpServers` from `settings.json` (user or project);
 * writing there is P1.
 *
 * The plugin install path (#341) is what `claude plugin marketplace add`
 * and `claude plugin install` write, per
 * https://code.claude.com/docs/en/plugins-reference and
 * https://code.claude.com/docs/en/plugin-marketplaces:
 *
 *   ~/.claude/plugins/known_marketplaces.json   added marketplaces
 *   ~/.claude/plugins/marketplaces/<name>/      the marketplace's copy
 *   ~/.claude/plugins/cache/<mkt>/<plugin>/<v>/ the installed plugin
 *   ~/.claude/plugins/installed_plugins.json    installs, by `plugin@mkt`
 *   ~/.claude/plugins/data/<id>/                `${CLAUDE_PLUGIN_DATA}`,
 *                                               deleted on uninstall
 *   ~/.claude/settings.json → enabledPlugins    `plugin@mkt: true`
 *
 * At session start Claude Code loads every enabled plugin: it substitutes
 * `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in hook commands and
 * MCP configs, and exports both to hook and MCP server processes.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { runHookCommand } from "../hook-process";
import type {
	CaseError,
	ConfigSource,
	Env,
	HostSpec,
	PathCtx,
	ReadFile,
	Result,
} from "../types";
import { at } from "./select";

// ── Plugin file contract ───────────────────────────────────────────────────

/** Where a marketplace lists its plugins, from its root. */
const MARKETPLACE_FILE = join(".claude-plugin", "marketplace.json");

export interface InstalledPlugin {
	/** `plugin@marketplace`. */
	readonly key: string;
	/** `${CLAUDE_PLUGIN_ROOT}`: the installed copy. */
	readonly root: string;
	/** `${CLAUDE_PLUGIN_DATA}`. */
	readonly data: string;
}

type Json = Record<string, unknown>;

const pluginsDir = (home: string): string => join(home, ".claude", "plugins");
const settingsFile = (home: string): string =>
	join(home, ".claude", "settings.json");
const knownFile = (home: string): string =>
	join(pluginsDir(home), "known_marketplaces.json");
const installedFile = (home: string): string =>
	join(pluginsDir(home), "installed_plugins.json");

/** `~/.claude/plugins/data/<id>`: the key with anything unsafe as `-`. */
export function pluginDataDir(home: string, key: string): string {
	return join(pluginsDir(home), "data", key.replace(/[^A-Za-z0-9_-]/g, "-"));
}

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

const writeJsonSync = (path: string, value: unknown): void => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

/** The real file system, as the host's own CLI reads it. */
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

/** `obj` without `key`. */
const without = (obj: Json, key: string): Json =>
	Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

/** The plugins every enabled `plugin@mkt` resolves to, as a session loads them. */
export function enabledPlugins(
	home: string,
	readFile: ReadFile,
): readonly InstalledPlugin[] {
	const enabled = at(readJson(settingsFile(home), readFile), [
		"enabledPlugins",
	]);
	const installs = at(readJson(installedFile(home), readFile), ["plugins"]);
	if (enabled === null || typeof enabled !== "object") return [];
	return Object.entries(enabled as Json)
		.filter(([, on]) => on === true)
		.flatMap(([key]) => {
			const entries = at(installs, [key]);
			const user = Array.isArray(entries)
				? (entries as Json[]).find((e) => e.scope === "user")
				: undefined;
			return typeof user?.installPath === "string"
				? [{ key, root: user.installPath, data: pluginDataDir(home, key) }]
				: [];
		});
}

/** What Claude Code exports to a plugin's hooks and servers. */
export function pluginEnv(plugin: InstalledPlugin): Env {
	return { CLAUDE_PLUGIN_ROOT: plugin.root, CLAUDE_PLUGIN_DATA: plugin.data };
}

const expand = (value: string, vars: Env): string =>
	value.replace(/\$\{([A-Z_]+)\}/g, (m, name: string) => vars[name] ?? m);

/** `value` with every string (deeply) expanded. */
function expandAll(value: unknown, vars: Env): unknown {
	if (typeof value === "string") return expand(value, vars);
	if (Array.isArray(value)) return value.map((v) => expandAll(v, vars));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, expandAll(v, vars)]),
		);
	}
	return value;
}

/** Each enabled plugin's `.mcp.json`, lowest precedence. */
function pluginMcpSources(
	home: string,
	readFile: ReadFile,
): readonly ConfigSource[] {
	return enabledPlugins(home, readFile).map((plugin) => ({
		path: join(plugin.root, ".mcp.json"),
		format: "json",
		select: (parsed) => {
			const entry = at(parsed, ["mcpServers", "maina"]);
			if (entry === undefined) return undefined;
			const vars = pluginEnv(plugin);
			const expanded = expandAll(entry, vars) as Json;
			const env = at(expanded, ["env"]);
			return {
				...expanded,
				env: { ...vars, ...(typeof env === "object" ? (env as Json) : {}) },
			};
		},
	}));
}

export interface PluginHook {
	readonly plugin: InstalledPlugin;
	/** The command, variables substituted. */
	readonly command: string;
}

/**
 * The enabled plugins' hook commands for `event` (and, for tool events,
 * `tool`), in registration order. A matcher is a regex over the tool
 * name; none, `""` or `*` matches every tool.
 */
export function pluginHooks(
	home: string,
	readFile: ReadFile,
	event: string,
	tool?: string,
): readonly PluginHook[] {
	return enabledPlugins(home, readFile).flatMap((plugin) => {
		const groups = at(
			readJson(join(plugin.root, "hooks", "hooks.json"), readFile),
			["hooks", event],
		);
		if (!Array.isArray(groups)) return [];
		return (groups as Json[])
			.filter((g) => {
				const m = g.matcher;
				if (typeof m !== "string" || m === "" || m === "*") return true;
				return tool !== undefined && new RegExp(m).test(tool);
			})
			.flatMap((g) => (Array.isArray(g.hooks) ? (g.hooks as Json[]) : []))
			.filter((h) => h.type === "command" && typeof h.command === "string")
			.map((h) => ({
				plugin,
				command: expand(h.command as string, pluginEnv(plugin)),
			}));
	});
}

type Fail = Result<never, string>;
const fail = (error: string): Fail => ({ ok: false, error });

/** `claude plugin marketplace add <source>`: resolves to the marketplace name. */
export function marketplaceAdd(
	home: string,
	source: string,
	readFile: ReadFile,
): Result<string, string> {
	const listing = readJson(join(source, MARKETPLACE_FILE), readFile);
	const name = listing?.name;
	if (typeof name !== "string" || !Array.isArray(listing?.plugins)) {
		return fail(`${source} has no valid ${MARKETPLACE_FILE}`);
	}
	const installLocation = join(pluginsDir(home), "marketplaces", name);
	mkdirSync(dirname(installLocation), { recursive: true });
	cpSync(source, installLocation, { recursive: true });
	const known = readJson(knownFile(home), readFile) ?? {};
	writeJsonSync(knownFile(home), {
		...known,
		[name]: {
			source: { source: "directory", path: source },
			installLocation,
			lastUpdated: new Date().toISOString(),
		},
	});
	return { ok: true, value: name };
}

/** `claude plugin install <plugin>@<marketplace>` (user scope). */
export function pluginInstall(
	home: string,
	key: string,
	readFile: ReadFile,
): Result<InstalledPlugin, string> {
	const [name, mkt] = key.split("@");
	if (!name || !mkt) return fail(`not plugin@marketplace: ${key}`);
	const location = at(readJson(knownFile(home), readFile), [
		mkt,
		"installLocation",
	]);
	if (typeof location !== "string") return fail(`unknown marketplace ${mkt}`);
	const plugins = at(readJson(join(location, MARKETPLACE_FILE), readFile), [
		"plugins",
	]);
	const entry = Array.isArray(plugins)
		? (plugins as Json[]).find((p) => p.name === name)
		: undefined;
	if (entry === undefined) return fail(`${mkt} lists no plugin ${name}`);
	const source = entry.source;
	// Only relative sources are exercised here; they resolve against the
	// marketplace root and may not leave it.
	if (typeof source !== "string" || !source.startsWith("./")) {
		return fail(`${key}: unsupported source ${JSON.stringify(source)}`);
	}
	const from = resolve(location, source);
	if (!inside(location, from)) return fail(`${key}: source leaves ${mkt}`);
	const manifest = readJson(
		join(from, ".claude-plugin", "plugin.json"),
		readFile,
	);
	const version =
		typeof manifest?.version === "string"
			? manifest.version
			: typeof entry.version === "string"
				? entry.version
				: "unknown";
	const root = join(pluginsDir(home), "cache", mkt, name, version);
	mkdirSync(dirname(root), { recursive: true });
	cpSync(from, root, { recursive: true });
	const now = new Date().toISOString();
	const installed = readJson(installedFile(home), readFile);
	const byKey = (at(installed, ["plugins"]) as Json | undefined) ?? {};
	writeJsonSync(installedFile(home), {
		version: 2,
		plugins: {
			...byKey,
			[key]: [
				{
					scope: "user",
					installPath: root,
					version,
					installedAt: now,
					lastUpdated: now,
				},
			],
		},
	});
	const settings = readJson(settingsFile(home), readFile) ?? {};
	const enabled = (at(settings, ["enabledPlugins"]) as Json | undefined) ?? {};
	writeJsonSync(settingsFile(home), {
		...settings,
		enabledPlugins: { ...enabled, [key]: true },
	});
	return { ok: true, value: { key, root, data: pluginDataDir(home, key) } };
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

/**
 * `claude plugin uninstall <plugin>@<marketplace>`: removes the installed
 * copy, its data dir, its install record and its enabledPlugins key.
 */
export function pluginUninstall(
	home: string,
	key: string,
	readFile: ReadFile,
): Result<void, string> {
	const installed = readJson(installedFile(home), readFile);
	const byKey = (at(installed, ["plugins"]) as Json | undefined) ?? {};
	const entries = byKey[key];
	if (!Array.isArray(entries)) return fail(`${key} is not installed`);
	for (const e of entries as Json[]) {
		if (typeof e.installPath !== "string") continue;
		rmSync(e.installPath, { recursive: true, force: true });
		pruneEmpty(dirname(e.installPath), join(pluginsDir(home), "cache"));
	}
	rmSync(pluginDataDir(home, key), { recursive: true, force: true });
	writeJsonSync(installedFile(home), {
		version: 2,
		plugins: without(byKey, key),
	});
	const settings = readJson(settingsFile(home), readFile) ?? {};
	const enabled = without(
		(at(settings, ["enabledPlugins"]) as Json | undefined) ?? {},
		key,
	);
	writeJsonSync(
		settingsFile(home),
		Object.keys(enabled).length > 0
			? { ...settings, enabledPlugins: enabled }
			: without(settings, "enabledPlugins"),
	);
	return { ok: true, value: undefined };
}

/** `claude plugin marketplace remove <name>`. */
export function marketplaceRemove(
	home: string,
	name: string,
	readFile: ReadFile,
): Result<void, string> {
	const known = readJson(knownFile(home), readFile) ?? {};
	if (!(name in known)) return fail(`unknown marketplace ${name}`);
	rmSync(join(pluginsDir(home), "marketplaces", name), {
		recursive: true,
		force: true,
	});
	writeJsonSync(knownFile(home), without(known, name));
	return { ok: true, value: undefined };
}

// ── Hook payloads (https://code.claude.com/docs/en/hooks) ──────────────────

const SESSION_ID = "e2e-real-config-session";

const common = (cwd: string, event: string) => ({
	session_id: SESSION_ID,
	transcript_path: join(cwd, ".claude-e2e-transcript.jsonl"),
	cwd,
	hook_event_name: event,
});

export const sessionStartInput = (cwd: string) => ({
	...common(cwd, "SessionStart"),
	source: "startup",
});

export const bashInput = (cwd: string, command: string) => ({
	...common(cwd, "PreToolUse"),
	permission_mode: "default",
	tool_name: "Bash",
	tool_input: { command, description: command },
	tool_use_id: "toolu_e2e",
});

export const writeInput = (cwd: string, filePath: string, content: string) => ({
	...common(cwd, "PreToolUse"),
	permission_mode: "default",
	tool_name: "Write",
	tool_input: { file_path: filePath, content },
	tool_use_id: "toolu_e2e",
});

/** What maina tells the agent at session start when its gate is live. */
export const ONBOARDING = "maina guardrails active";

/** The env Claude Code gives one plugin's hook process. */
export function hookEnv(env: Env, plugin: InstalledPlugin, cwd: string): Env {
	return { ...env, ...pluginEnv(plugin), CLAUDE_PROJECT_DIR: cwd };
}

/** The first session's SessionStart hooks, as Claude Code runs them. */
async function startSession(
	{ home, cwd }: PathCtx,
	env: Env,
	readFile: ReadFile,
): Promise<Result<string, CaseError>> {
	const failed = (message: string): Result<string, CaseError> => ({
		ok: false,
		error: { kind: "session-start-failed", message },
	});
	const hooks = pluginHooks(home, readFile, "SessionStart");
	if (hooks.length === 0) return failed("no enabled plugin hooks SessionStart");
	const contexts: string[] = [];
	for (const hook of hooks) {
		const run = await runHookCommand(
			hook.command,
			sessionStartInput(cwd),
			hookEnv(env, hook.plugin, cwd),
			cwd,
		);
		const out = parse(run.stdout.trim());
		const context = at(out, ["hookSpecificOutput", "additionalContext"]);
		if (run.exitCode !== 0 || typeof context !== "string") {
			return failed(
				`SessionStart hook exited ${run.exitCode}: ${run.stdout}${run.stderr}`.slice(
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
		: failed(`SessionStart did not onboard: ${context}`);
}

// ── Host spec ──────────────────────────────────────────────────────────────

/** The plugin the install path installs, from the repo's marketplace. */
export const MAINA_PLUGIN = "maina@maina";

export const claudeCode: HostSpec = {
	id: "claude-code",
	mcpAddClient: "claude",
	// Every Claude Code user has `~/.claude.json` (startup counters, per-
	// project state, their own servers) and usually hooks/permissions in
	// `~/.claude/settings.json`.
	seeds: ({ home }) => [
		{
			path: join(home, ".claude.json"),
			format: "json",
			content: `${JSON.stringify(
				{
					numStartups: 3,
					projects: {},
					mcpServers: { memory: { command: "memory-server" } },
				},
				null,
				2,
			)}\n`,
			intact: (parsed) =>
				at(parsed, ["numStartups"]) === 3 &&
				at(parsed, ["mcpServers", "memory", "command"]) === "memory-server",
		},
		{
			path: join(home, ".claude", "settings.json"),
			format: "json",
			content: `${JSON.stringify(
				{
					hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] },
					permissions: { allow: ["Bash(ls:*)"] },
				},
				null,
				2,
			)}\n`,
			intact: (parsed) =>
				at(parsed, ["hooks", "Stop"]) !== undefined &&
				at(parsed, ["permissions", "allow"]) !== undefined &&
				at(parsed, ["mcpServers"]) === undefined,
		},
	],
	configSources: ({ home, cwd }, read) => {
		const userFile = join(home, ".claude.json");
		return [
			{
				path: userFile,
				format: "json",
				select: (parsed) =>
					at(at(parsed, ["projects"]), [cwd, "mcpServers", "maina"]),
			},
			{
				path: join(cwd, ".mcp.json"),
				format: "json",
				select: (parsed) => at(parsed, ["mcpServers", "maina"]),
			},
			{
				path: userFile,
				format: "json",
				select: (parsed) => at(parsed, ["mcpServers", "maina"]),
			},
			...pluginMcpSources(home, read),
		];
	},
	strayPaths: ({ home, cwd }) => [
		join(home, ".claude", "settings.json"),
		join(cwd, ".claude", "settings.json"),
		join(cwd, ".claude", "settings.local.json"),
	],
	plugin: {
		install: ({ home }, source) => {
			const failed = (message: string): Result<void, CaseError> => ({
				ok: false,
				error: { kind: "installer-failed", message, exitCode: 1 },
			});
			const added = marketplaceAdd(home, source, readFileOrNull);
			if (!added.ok) return failed(added.error);
			const installed = pluginInstall(home, MAINA_PLUGIN, readFileOrNull);
			return installed.ok
				? { ok: true, value: undefined }
				: failed(installed.error);
		},
		startSession: (ctx, env) => startSession(ctx, env, readFileOrNull),
	},
};
