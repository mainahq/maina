/**
 * Codex CLI reads MCP servers from `$CODEX_HOME/config.toml` (default
 * `~/.codex/config.toml`) under `[mcp_servers.<name>]`, then from each
 * enabled plugin's `mcp.json`. The harness never sets CODEX_HOME, so the
 * default applies.
 *
 * The plugin install path (#343), per
 * https://developers.openai.com/codex/plugins/build and
 * https://developers.openai.com/codex/rules:
 *
 *   <repo>/.agents/plugins/marketplace.json     the repo's marketplace; an
 *                                               entry's `local` source is a
 *                                               folder inside it
 *   ~/.codex/plugins/cache/<mkt>/<plugin>/local the installed copy of a
 *                                               local plugin: PLUGIN_ROOT
 *   ~/.codex/plugins/data/<plugin>-<mkt>/       PLUGIN_DATA, deleted on
 *                                               uninstall
 *   ~/.codex/config.toml → [plugins."<plugin>@<mkt>"] enabled = true
 *   ~/.codex/config.toml → [projects."<dir>"] trust_level = "trusted"
 *
 * At session start Codex runs an enabled plugin's hooks (the file its
 * manifest's `extensions["com.openai"].hooks` names) in the session's
 * working directory, with PLUGIN_ROOT and PLUGIN_DATA exported, and starts
 * its MCP server with the same two variables; a `./` command resolves
 * against the plugin root.
 *
 * Command policy: Codex loads the `.rules` files in `rules/` of
 * `$CODEX_HOME`, and, only once the user trusts the project, those of the
 * project's `.codex/` and of each enabled plugin. It applies the strictest
 * matching rule (`forbidden` over `prompt` over `allow`) before any hook.
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
import { ONBOARDING } from "./claude-code";
import { at } from "./select";

// ── Plugin file contract ───────────────────────────────────────────────────

/** Where a repo lists its plugins, from its root. */
const MARKETPLACE_FILE = join(".agents", "plugins", "marketplace.json");

/** The plugin the install path installs, as `plugin@marketplace`. */
export const CODEX_PLUGIN = "maina@maina";

/** The version folder Codex installs a `local` plugin under. */
const LOCAL_VERSION = "local";

export interface InstalledPlugin {
	/** `plugin@marketplace`. */
	readonly key: string;
	/** PLUGIN_ROOT: the installed copy. */
	readonly root: string;
	/** PLUGIN_DATA. */
	readonly data: string;
}

type Json = Record<string, unknown>;

/** Lists a folder's entries; empty when it is missing. */
export type ListDir = (dir: string) => readonly string[];

const codexDir = (home: string): string => join(home, ".codex");
const configFile = (home: string): string =>
	join(codexDir(home), "config.toml");
const pluginsDir = (home: string): string => join(codexDir(home), "plugins");

/** `~/.codex/plugins/data/<id>`: the key with anything unsafe as `-`. */
export function pluginDataDir(home: string, key: string): string {
	return join(pluginsDir(home), "data", key.replace(/[^A-Za-z0-9_-]/g, "-"));
}

const isObject = (value: unknown): value is Json =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const parseJson = (raw: string | null): Json | undefined => {
	if (raw === null) return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		return isObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
};

const parseToml = (raw: string | null): Json | undefined => {
	if (raw === null) return undefined;
	try {
		const value: unknown = Bun.TOML.parse(raw);
		return isObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
};

const readJson = (path: string, readFile: ReadFile): Json | undefined =>
	parseJson(readFile(path));

/** The real file system, as Codex reads it. */
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

/** A TOML table header for a quoted key: `[table."key"]`. */
const tableHeader = (table: string, key: string): string =>
	`[${table}.${JSON.stringify(key)}]`;

/** The enabled plugins, as a session loads them. */
export function installedPlugins(
	home: string,
	readFile: ReadFile,
): readonly InstalledPlugin[] {
	const plugins = at(parseToml(readFile(configFile(home))), ["plugins"]);
	if (!isObject(plugins)) return [];
	return Object.entries(plugins).flatMap(([key, value]) => {
		const [name, mkt] = key.split("@");
		if (!name || !mkt || !isObject(value) || value.enabled !== true) return [];
		const root = join(pluginsDir(home), "cache", mkt, name, LOCAL_VERSION);
		const manifest = readJson(join(root, "plugin.json"), readFile);
		return manifest?.name === name
			? [{ key, root, data: pluginDataDir(home, key) }]
			: [];
	});
}

/** What Codex exports to a plugin's hooks and MCP server. */
export function pluginEnv(plugin: InstalledPlugin): Env {
	return { PLUGIN_ROOT: plugin.root, PLUGIN_DATA: plugin.data };
}

const expand = (value: string, vars: Env): string =>
	value.replace(/\$\{([A-Z_]+)\}/g, (m, name: string) => vars[name] ?? m);

/** Each enabled plugin's `mcp.json`, lowest precedence. */
function pluginMcpSources(
	home: string,
	readFile: ReadFile,
): readonly ConfigSource[] {
	return installedPlugins(home, readFile).map((plugin) => ({
		path: join(plugin.root, "mcp.json"),
		format: "json",
		select: (parsed) => {
			const entry = at(parsed, ["mcpServers", "maina"]);
			if (!isObject(entry) || typeof entry.command !== "string") return entry;
			const vars = pluginEnv(plugin);
			const command = expand(entry.command, vars);
			const env = isObject(entry.env) ? entry.env : {};
			return {
				...entry,
				command: command.startsWith("./")
					? resolve(plugin.root, command)
					: command,
				env: { ...vars, ...env },
			};
		},
	}));
}

export interface PluginHook {
	readonly plugin: InstalledPlugin;
	/** The command, variables substituted. */
	readonly command: string;
}

/** The hooks file an installed plugin's manifest names. */
function hooksFile(plugin: InstalledPlugin, readFile: ReadFile): string | null {
	const manifest = readJson(join(plugin.root, "plugin.json"), readFile);
	const path = at(manifest, ["extensions", "com.openai", "hooks"]);
	if (typeof path !== "string") return null;
	const full = resolve(plugin.root, path);
	return inside(plugin.root, full) ? full : null;
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
	return installedPlugins(home, readFile).flatMap((plugin) => {
		const file = hooksFile(plugin, readFile);
		const groups =
			file === null
				? undefined
				: at(readJson(file, readFile), ["hooks", event]);
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

/** The env Codex gives one plugin's hook process. */
export function hookEnv(env: Env, plugin: InstalledPlugin): Env {
	return { ...env, ...pluginEnv(plugin) };
}

type Fail = Result<never, string>;
const fail = (error: string): Fail => ({ ok: false, error });

/** Appends a TOML table to config.toml, as Codex adds one it manages. */
function appendTable(home: string, header: string, body: string): void {
	const path = configFile(home);
	const current = readFileOrNull(path) ?? "";
	const gap = current === "" || current.endsWith("\n\n") ? "" : "\n";
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${current}${gap}${header}\n${body}`);
}

/**
 * `/plugins` install of `plugin@<marketplace>` from the marketplace at
 * `marketplace` (a repo checkout): the listed local plugin, copied to the
 * cache, and enabled in config.toml.
 */
export function pluginInstall(
	home: string,
	marketplace: string,
	name: string,
	readFile: ReadFile,
): Result<InstalledPlugin, string> {
	const listing = readJson(join(marketplace, MARKETPLACE_FILE), readFile);
	const mkt = listing?.name;
	if (typeof mkt !== "string" || !Array.isArray(listing?.plugins)) {
		return fail(`${marketplace} has no valid ${MARKETPLACE_FILE}`);
	}
	const entry = (listing.plugins as Json[]).find((p) => p.name === name);
	if (entry === undefined) return fail(`${mkt} lists no plugin ${name}`);
	const source = entry.source;
	const path = at(source, ["path"]);
	if (at(source, ["source"]) !== "local" || typeof path !== "string") {
		return fail(`${name}: unsupported source ${JSON.stringify(source)}`);
	}
	const from = resolve(marketplace, path);
	if (!path.startsWith("./") || !inside(marketplace, from)) {
		return fail(`${name}: source ${path} leaves the marketplace`);
	}
	const manifest = readJson(join(from, "plugin.json"), readFile);
	if (manifest?.name !== name) {
		return fail(`${name}: no plugin.json named ${name}`);
	}
	const key = `${name}@${mkt}`;
	const root = join(pluginsDir(home), "cache", mkt, name, LOCAL_VERSION);
	mkdirSync(dirname(root), { recursive: true });
	cpSync(from, root, { recursive: true });
	appendTable(home, tableHeader("plugins", key), "enabled = true\n");
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

/** config.toml without the table `header` (up to the next table). */
function withoutTable(text: string, header: string): string {
	const lines = text.split("\n");
	const start = lines.indexOf(header);
	if (start < 0) return text;
	const next = lines.findIndex((l, i) => i > start && l.startsWith("["));
	const end = next < 0 ? lines.length : next;
	const kept = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
	// The blank line the table was appended after goes with it.
	return kept.replace(/\n\n+$/, "\n");
}

/**
 * `/plugins` uninstall: removes the installed copy, its data dir and its
 * config.toml table.
 */
export function pluginUninstall(
	home: string,
	key: string,
	readFile: ReadFile,
): Result<void, string> {
	const plugin = installedPlugins(home, readFile).find((p) => p.key === key);
	if (plugin === undefined) return fail(`${key} is not installed`);
	rmSync(plugin.root, { recursive: true, force: true });
	pruneEmpty(dirname(plugin.root), join(pluginsDir(home), "cache"));
	rmSync(plugin.data, { recursive: true, force: true });
	const path = configFile(home);
	const text = readFile(path) ?? "";
	const rest = withoutTable(text, tableHeader("plugins", key));
	if (rest.trim() === "") rmSync(path, { force: true });
	else writeFileSync(path, rest);
	return { ok: true, value: undefined };
}

/** What Codex records when the user trusts the project at `dir`. */
export function trustProject(home: string, dir: string): void {
	appendTable(home, tableHeader("projects", dir), 'trust_level = "trusted"\n');
}

// ── Command policy (https://developers.openai.com/codex/rules) ─────────────

function trusted(ctx: PathCtx, readFile: ReadFile): boolean {
	const config = parseToml(readFile(configFile(ctx.home)));
	return at(config, ["projects", ctx.cwd, "trust_level"]) === "trusted";
}

const rulesIn = (dir: string, listDir: ListDir): readonly string[] =>
	listDir(dir)
		.filter((name) => name.endsWith(".rules"))
		.sort()
		.map((name) => join(dir, name));

/** The `.rules` files Codex loads for a session in `ctx.cwd`, in order. */
export function loadedRules(
	ctx: PathCtx,
	readFile: ReadFile,
	listDir: ListDir,
): readonly string[] {
	const user = rulesIn(join(codexDir(ctx.home), "rules"), listDir);
	if (!trusted(ctx, readFile)) return user;
	return [
		...user,
		...rulesIn(join(ctx.cwd, ".codex", "rules"), listDir),
		...installedPlugins(ctx.home, readFile).flatMap((plugin) =>
			rulesIn(join(plugin.root, "rules"), listDir),
		),
	];
}

export type PolicyDecision = "forbidden" | "prompt" | "allow";

const STRICTNESS: readonly PolicyDecision[] = ["forbidden", "prompt", "allow"];

type PrefixRule = Readonly<{
	pattern: readonly (string | readonly string[])[];
	decision: PolicyDecision;
}>;

/**
 * The `prefix_rule(...)` calls of a `.rules` file, as maina writes them:
 * one `key = value` per line, each value a JSON-compatible literal. A
 * pattern element may list alternatives; `decision` defaults to `allow`.
 */
function prefixRules(text: string): readonly PrefixRule[] {
	const blocks = text.match(/^prefix_rule\(\n[\s\S]*?^\)$/gm) ?? [];
	return blocks.flatMap((block) => {
		const fields = Object.fromEntries(
			[...block.matchAll(/^\s+([a-z_]+) = (.+),$/gm)].map((m) => {
				try {
					return [m[1], JSON.parse(m[2] as string) as unknown];
				} catch {
					return [m[1], undefined];
				}
			}),
		);
		const pattern = fields.pattern;
		const decision = fields.decision ?? "allow";
		if (!Array.isArray(pattern) || !STRICTNESS.includes(decision)) return [];
		return [{ pattern, decision }];
	});
}

const matches = (rule: PrefixRule, argv: readonly string[]): boolean =>
	rule.pattern.length <= argv.length &&
	rule.pattern.every((token, i) =>
		Array.isArray(token) ? token.includes(argv[i]) : token === argv[i],
	);

/**
 * What Codex's command policy decides for `argv` under the loaded rules:
 * the strictest matching rule, or undefined when none matches (the hook
 * and Codex's approval mode decide).
 */
export function execPolicy(
	rules: readonly string[],
	argv: readonly string[],
): PolicyDecision | undefined {
	const hits = rules
		.flatMap(prefixRules)
		.filter((rule) => matches(rule, argv))
		.map((rule) => rule.decision);
	return STRICTNESS.find((decision) => hits.includes(decision));
}

// ── Hook payloads (https://developers.openai.com/codex/hooks) ──────────────

const SESSION_ID = "e2e-real-config-thread";

const common = (cwd: string, event: string) => ({
	session_id: SESSION_ID,
	transcript_path: join(cwd, ".codex-e2e-rollout.jsonl"),
	cwd,
	hook_event_name: event,
	model: "e2e",
	permission_mode: "default",
});

export const sessionStartInput = (cwd: string) => ({
	...common(cwd, "SessionStart"),
	source: "startup",
});

const toolInput = (cwd: string, tool: string, input: Json) => ({
	...common(cwd, "PreToolUse"),
	turn_id: "e2e-turn",
	tool_name: tool,
	tool_use_id: "call_e2e",
	tool_input: input,
});

export const bashInput = (cwd: string, command: string) =>
	toolInput(cwd, "Bash", { command });

export const applyPatchInput = (cwd: string, patch: string) =>
	toolInput(cwd, "apply_patch", { command: patch });

/** An `apply_patch` that adds one file. */
export const addFilePatch = (path: string, content: string): string =>
	`*** Begin Patch\n*** Add File: ${path}\n${content
		.split("\n")
		.map((line) => `+${line}`)
		.join("\n")}\n*** End Patch\n`;

/** The first session's SessionStart hooks, as Codex runs them. */
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
			hookEnv(env, hook.plugin),
			cwd,
		);
		const out = parseJson(run.stdout.trim());
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

export const codex: HostSpec = {
	id: "codex",
	mcpAddClient: "codex",
	seeds: ({ home }) => [
		{
			path: join(home, ".codex", "config.toml"),
			format: "toml",
			content:
				'# my codex config\nmodel = "o3"\n\n[mcp_servers.memory]\ncommand = "memory-server"\n',
			intact: (parsed) =>
				at(parsed, ["model"]) === "o3" &&
				at(parsed, ["mcp_servers", "memory", "command"]) === "memory-server",
		},
	],
	configSources: ({ home }, read) => [
		{
			path: join(home, ".codex", "config.toml"),
			format: "toml",
			select: (parsed) => at(parsed, ["mcp_servers", "maina"]),
		},
		...pluginMcpSources(home, read),
	],
	strayPaths: ({ cwd }) => [join(cwd, ".mcp.json")],
	plugin: {
		install: ({ home }, source) => {
			const [name] = CODEX_PLUGIN.split("@");
			const installed = pluginInstall(home, source, name ?? "", readFileOrNull);
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
