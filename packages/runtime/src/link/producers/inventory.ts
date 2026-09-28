/**
 * The `inventory` event (#591, spec §6.3, FR-INV-1): what this machine runs,
 * reported on start and on change, one event per installed agent.
 *
 * Per agent: its version, how many MCP servers it is configured with,
 * whether Maina's hooks are installed for it (`hooks: missing` when the
 * agent is on PATH but no Maina hook is), how many Maina plugins it has
 * enabled, and the runtime's version. Counts and booleans only: no MCP
 * server name, command or config path is sent.
 *
 * The pinned v1 schema has no field yet for the OS, the policy version and
 * hash, per-server hashes or sandbox availability, so they are not sent;
 * the schema forbids extra fields, and the cloud defines it.
 *
 * `collectInventory` reads through ports (the agents on PATH from the
 * harness registry, and the agents' user-level config files), so it runs
 * the same over a fake machine in the tests. Only user-level configs are
 * read: a repo's own `.claude/settings.json` is that repo's, and the
 * resident runtime serves every repo.
 */

import { join } from "node:path";
import type { Result } from "@mainahq/core";
import type { EventInput } from "../outbox";
import type { UplinkError } from "../uplink";
import { count, type EventSink, isLabel, isVersion, UNKNOWN } from "./emit";

export type AgentFacts = Readonly<{
	/** The agent's host label (`claude-code`, `codex`, ...). */
	agent: string;
	version?: string;
	hooks: "installed" | "missing";
	mcpServers: number;
	plugins: number;
}>;

export type InventoryFacts = Readonly<{
	runtimeVersion: string;
	agents: readonly AgentFacts[];
}>;

/** An agent CLI on PATH (harness `agentInventory`). */
type InstalledAgent = Readonly<{ name: string; version?: string }>;

export type InventoryPorts = Readonly<{
	agents: () => Promise<readonly InstalledAgent[]>;
	/** A file's text, or null when it cannot be read. */
	readText: (path: string) => string | null;
	home: string;
	/** `$CODEX_HOME`; defaults to `<home>/.codex`. */
	codexHome?: string;
	runtimeVersion: string;
}>;

// ── Where each agent keeps its hooks and MCP servers ───────────────────────

type ConfigFile = Readonly<{
	path: string;
	format: "json" | "toml";
	/** The key holding the MCP servers in a JSON config. */
	mcpKey?: string;
	/** The key holding enabled plugins (Claude Code's `enabledPlugins`). */
	pluginsKey?: string;
	/** Hooks are configured here. */
	hooks?: true;
}>;

type AgentConfig = Readonly<{ label: string; files: readonly ConfigFile[] }>;

function agentConfigs(
	home: string,
	codexHome: string,
): Readonly<Record<string, AgentConfig>> {
	return {
		claude: {
			label: "claude-code",
			files: [
				{
					path: join(home, ".claude", "settings.json"),
					format: "json",
					pluginsKey: "enabledPlugins",
					hooks: true,
				},
				{
					path: join(home, ".claude.json"),
					format: "json",
					mcpKey: "mcpServers",
				},
			],
		},
		codex: {
			label: "codex",
			files: [
				{ path: join(codexHome, "hooks.json"), format: "json", hooks: true },
				{ path: join(codexHome, "config.toml"), format: "toml", hooks: true },
			],
		},
		cursor: {
			label: "cursor",
			files: [
				{
					path: join(home, ".cursor", "hooks.json"),
					format: "json",
					hooks: true,
				},
				{
					path: join(home, ".cursor", "mcp.json"),
					format: "json",
					mcpKey: "mcpServers",
				},
			],
		},
		gemini: {
			label: "gemini",
			files: [
				{
					path: join(home, ".gemini", "settings.json"),
					format: "json",
					mcpKey: "mcpServers",
					hooks: true,
				},
			],
		},
		opencode: {
			label: "opencode",
			files: [
				{
					path: join(home, ".config", "opencode", "opencode.json"),
					format: "json",
					mcpKey: "mcp",
					hooks: true,
				},
			],
		},
	};
}

// ── Reading a config (pure) ────────────────────────────────────────────────

/** Maina's hook command: its launcher or CLI running `hook <event>`. */
const MAINA_HOOK = /\bmaina\b[^\n]*?\shook\b/;
/** A Maina plugin id (`maina@mainahq`). */
const MAINA_PLUGIN = /^maina(@|$)/;
/** A TOML MCP server table: `[mcp_servers.<name>]`. */
const TOML_MCP_SERVER = /^\s*\[mcp_servers\.("[^"]*"|[^\].\s]+)\]\s*$/gm;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): Readonly<Record<string, unknown>> | null {
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

type FileFacts = Readonly<{
	hooks: boolean;
	mcpServers: number;
	plugins: number;
}>;

const NOTHING: FileFacts = { hooks: false, mcpServers: 0, plugins: 0 };

function readConfig(file: ConfigFile, text: string): FileFacts {
	const hooks = file.hooks === true && MAINA_HOOK.test(text);
	if (file.format === "toml") {
		const names = new Set([...text.matchAll(TOML_MCP_SERVER)].map((m) => m[1]));
		return { hooks, mcpServers: names.size, plugins: 0 };
	}
	const json = parseJson(text);
	if (json === null) return NOTHING;
	const servers = file.mcpKey === undefined ? undefined : json[file.mcpKey];
	const enabled =
		file.pluginsKey === undefined ? undefined : json[file.pluginsKey];
	const plugins = isRecord(enabled)
		? Object.entries(enabled).filter(
				([id, on]) => on === true && MAINA_PLUGIN.test(id),
			).length
		: 0;
	return {
		// A Maina plugin carries Maina's hooks.
		hooks: hooks || plugins > 0,
		mcpServers: isRecord(servers) ? Object.keys(servers).length : 0,
		plugins,
	};
}

/** What this machine runs, through `ports`. Never rejects. */
export async function collectInventory(
	ports: InventoryPorts,
): Promise<InventoryFacts> {
	const configs = agentConfigs(
		ports.home,
		ports.codexHome ?? join(ports.home, ".codex"),
	);
	let installed: readonly InstalledAgent[];
	try {
		installed = await ports.agents();
	} catch {
		installed = [];
	}
	const agents = installed.flatMap((found): AgentFacts[] => {
		if (!Object.hasOwn(configs, found.name)) return [];
		const config = configs[found.name];
		if (config === undefined) return [];
		const facts = config.files.map((file) => {
			const text = ports.readText(file.path);
			return text === null ? NOTHING : readConfig(file, text);
		});
		return [
			{
				agent: config.label,
				...(found.version === undefined ? {} : { version: found.version }),
				hooks: facts.some((f) => f.hooks) ? "installed" : "missing",
				mcpServers: facts.reduce((n, f) => n + f.mcpServers, 0),
				plugins: facts.reduce((n, f) => n + f.plugins, 0),
			},
		];
	});
	return { runtimeVersion: ports.runtimeVersion, agents };
}

// ── Events ─────────────────────────────────────────────────────────────────

/** One metadata `inventory` event per agent whose label is a label. */
export function inventoryEvents(facts: InventoryFacts): readonly EventInput[] {
	return facts.agents.flatMap((a): EventInput[] =>
		isLabel(a.agent)
			? [
					{
						type: "inventory",
						data: {
							agent: a.agent,
							agentVersion: isVersion(a.version) ? a.version : UNKNOWN,
							mcpServers: count(a.mcpServers),
							hooksInstalled: a.hooks === "installed",
							...(isVersion(facts.runtimeVersion)
								? { runtimeVersion: facts.runtimeVersion }
								: {}),
							plugins: count(a.plugins),
						},
					},
				]
			: [],
	);
}

type InventoryReporter = Readonly<{
	/** Enqueues each agent's event that changed since it was last queued; resolves to how many. */
	report: (facts: InventoryFacts) => Result<number, UplinkError>;
}>;

/**
 * Reports inventory on change: the first report sends every agent, a later
 * one only an agent whose event differs from the one last queued. An event
 * the sink did not queue (the device is not enrolled) is sent again next
 * time, so enrolling sends the inventory on the next report.
 */
export function createInventoryReporter(sink: EventSink): InventoryReporter {
	const last = new Map<string, string>();
	return {
		report: (facts) => {
			let queued = 0;
			for (const input of inventoryEvents(facts)) {
				const agent = String(input.data.agent);
				const key = JSON.stringify(input.data);
				if (last.get(agent) === key) continue;
				const sent = sink.enqueue(input);
				if (!sent.ok) return sent;
				if (sent.value.queued) {
					last.set(agent, key);
					queued++;
				}
			}
			return { ok: true, value: queued };
		},
	};
}
