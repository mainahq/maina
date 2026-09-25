/**
 * Host config targets (FR-INS-4): the files each AI host actually reads
 * MCP servers from, and where maina's entry sits inside them.
 *
 * This is the single source of truth for host config locations. `maina
 * mcp add/remove/list`, `maina setup` and `maina doctor` all resolve paths
 * here, so a host is never configured through a file it ignores (P1).
 *
 * Claude Code reads MCP servers from `<repo>/.mcp.json` (project scope)
 * and `~/.claude.json` (user scope). It never reads `mcpServers` from any
 * `settings.json`, so no target here points at one.
 *
 * Pure: paths are derived from the injected `PathContext` only.
 */

import { join, relative, sep } from "node:path";
import type { McpClientId, McpScope } from "./types";

export type TargetScope = "global" | "project";

export interface PathContext {
	readonly home: string;
	readonly cwd: string;
	readonly platform?: NodeJS.Platform;
	/** Windows `%APPDATA%`; defaults to `<home>/AppData/Roaming`. */
	readonly appData?: string;
	/** `$CODEX_HOME`; defaults to `<home>/.codex`. */
	readonly codexHome?: string;
}

/** One host config file and where maina's entry lives in it. */
export interface TargetFile {
	readonly host: McpClientId;
	readonly scope: TargetScope;
	/** Absolute path of the config file. */
	readonly path: string;
	readonly format: "json" | "toml";
	/** Path to the container holding the MCP servers. */
	readonly containerPath: readonly string[];
	/**
	 * `object`: servers keyed by name, maina's key is `entryKey`.
	 * `array`: a list of servers, maina's is the one whose `name` is
	 * `entryKey` (Continue's legacy shape).
	 */
	readonly container: "object" | "array";
	readonly entryKey: string;
	/** Where the pre-maina copy of `path` is kept. */
	readonly backupPath: string;
}

/** Where maina's entry sits inside a config file, whatever the file. */
export type EntryShape = Pick<
	TargetFile,
	"format" | "containerPath" | "container" | "entryKey"
>;

const MCP_SERVERS: EntryShape = {
	format: "json",
	containerPath: ["mcpServers"],
	container: "object",
	entryKey: "maina",
};

interface HostLocations {
	readonly shape: EntryShape;
	readonly global: (c: Required<PathContext>) => string;
	/** Relative to the repo root; absent when the host has no project file. */
	readonly project?: readonly string[];
}

function vsCodeUserDir(c: Required<PathContext>): string {
	if (c.platform === "darwin") {
		return join(c.home, "Library", "Application Support", "Code", "User");
	}
	if (c.platform === "win32") return join(c.appData, "Code", "User");
	return join(c.home, ".config", "Code", "User");
}

function zedConfigDir(c: Required<PathContext>): string {
	return c.platform === "win32"
		? join(c.appData, "Zed")
		: join(c.home, ".config", "zed");
}

const HOSTS: Readonly<Record<McpClientId, HostLocations>> = {
	claude: {
		shape: MCP_SERVERS,
		global: (c) => join(c.home, ".claude.json"),
		project: [".mcp.json"],
	},
	cursor: {
		shape: MCP_SERVERS,
		global: (c) => join(c.home, ".cursor", "mcp.json"),
		project: [".cursor", "mcp.json"],
	},
	windsurf: {
		shape: MCP_SERVERS,
		global: (c) => join(c.home, ".codeium", "windsurf", "mcp_config.json"),
	},
	cline: {
		shape: MCP_SERVERS,
		global: (c) =>
			join(
				vsCodeUserDir(c),
				"globalStorage",
				"saoudrizwan.claude-dev",
				"settings",
				"cline_mcp_settings.json",
			),
	},
	codex: {
		shape: {
			format: "toml",
			containerPath: ["mcp_servers"],
			container: "object",
			entryKey: "maina",
		},
		global: (c) => join(c.codexHome, "config.toml"),
	},
	continue: {
		// Continue's legacy `config.json` `experimental` block is JSON and
		// still honoured; the newer per-server YAML files are a follow-up.
		shape: {
			format: "json",
			containerPath: ["experimental", "modelContextProtocolServers"],
			container: "array",
			entryKey: "maina",
		},
		global: (c) => join(c.home, ".continue", "config.json"),
		project: [".continue", "config.json"],
	},
	gemini: {
		shape: MCP_SERVERS,
		global: (c) => join(c.home, ".gemini", "settings.json"),
	},
	zed: {
		shape: {
			format: "json",
			containerPath: ["context_servers"],
			container: "object",
			entryKey: "maina",
		},
		global: (c) => join(zedConfigDir(c), "settings.json"),
	},
};

function resolveContext(ctx: PathContext): Required<PathContext> {
	return {
		home: ctx.home,
		cwd: ctx.cwd,
		platform: ctx.platform ?? "linux",
		appData: ctx.appData ?? join(ctx.home, "AppData", "Roaming"),
		codexHome: ctx.codexHome ?? join(ctx.home, ".codex"),
	};
}

/**
 * Backups of global files mirror their path below `~`; a file outside the
 * home directory (e.g. `$CODEX_HOME=/opt/codex`) is keyed by its absolute
 * path with separators flattened.
 */
function globalBackupPath(home: string, path: string): string {
	const rel = relative(home, path);
	const inside = rel.length > 0 && !rel.startsWith("..") && !rel.includes(":");
	const key = inside
		? rel
		: join(
				"abs",
				path
					.replace(/^[A-Za-z]:/, "")
					.split(sep)
					.join("_"),
			);
	return join(home, ".maina", "backups", "global", key);
}

/**
 * The config files `host` reads for `scope`, global first. A host with no
 * project-scope file returns no project target.
 */
export function targetsFor(
	host: McpClientId,
	scope: McpScope,
	ctx: PathContext,
): readonly TargetFile[] {
	const c = resolveContext(ctx);
	const loc = HOSTS[host];
	const out: TargetFile[] = [];
	if (scope === "global" || scope === "both") {
		const path = loc.global(c);
		out.push({
			host,
			scope: "global",
			path,
			...loc.shape,
			backupPath: globalBackupPath(c.home, path),
		});
	}
	if ((scope === "project" || scope === "both") && loc.project) {
		out.push({
			host,
			scope: "project",
			path: join(c.cwd, ...loc.project),
			...loc.shape,
			// Same place `maina setup` keeps its backups of repo files.
			backupPath: join(c.cwd, ".maina", "backups", ...loc.project),
		});
	}
	return out;
}

/**
 * Files installers are known to have written `host`'s MCP entry into that
 * the host never reads (P1): Claude Code's `settings.json` files. Nothing
 * adds an entry here; `maina doctor` reports one as broken and the 1.x
 * migration (`../onboarding/migrate-1x.ts`) removes a stale one.
 */
const IGNORED: Readonly<
	Partial<
		Record<
			McpClientId,
			{
				readonly global: readonly (readonly string[])[];
				readonly project: readonly (readonly string[])[];
			}
		>
	>
> = {
	claude: {
		global: [[".claude", "settings.json"]],
		project: [
			[".claude", "settings.json"],
			[".claude", "settings.local.json"],
		],
	},
};

/** The files `host` ignores that may still hold a maina entry. */
export function ignoredTargets(
	host: McpClientId,
	ctx: PathContext,
): readonly TargetFile[] {
	const ignored = IGNORED[host];
	if (ignored === undefined) return [];
	const c = resolveContext(ctx);
	const file = (scope: TargetScope, path: string): TargetFile => ({
		host,
		scope,
		path,
		...MCP_SERVERS,
		backupPath:
			scope === "global"
				? globalBackupPath(c.home, path)
				: join(c.cwd, ".maina", "backups", relative(c.cwd, path)),
	});
	return [
		...ignored.global.map((rel) => file("global", join(c.home, ...rel))),
		...ignored.project.map((rel) => file("project", join(c.cwd, ...rel))),
	];
}

/**
 * Whether `maina setup` wires `host` per project: its project file holds
 * servers under `mcpServers`, which the onboarding plan merges into.
 */
export function wiredPerProject(host: McpClientId): boolean {
	const loc = HOSTS[host];
	return loc.shape === MCP_SERVERS && loc.project !== undefined;
}

/**
 * Repo-relative (`/`-separated) project files that hold servers under
 * `mcpServers` — the files `maina setup` merges `mcpServers.maina` into.
 */
export function projectMcpServersFiles(): readonly string[] {
	return (Object.keys(HOSTS) as McpClientId[]).flatMap((host) => {
		const project = HOSTS[host].project;
		return wiredPerProject(host) && project ? [project.join("/")] : [];
	});
}
