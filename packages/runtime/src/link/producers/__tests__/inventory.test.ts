/**
 * The `inventory` producer (#591, spec §6.3, FR-INV-1): on start and on
 * change, one metadata event per installed agent: its version, how many MCP
 * servers it is configured with, whether Maina's hooks are installed for it
 * and how many Maina plugins it has, beside the runtime's version.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	collectInventory,
	createInventoryReporter,
	type InventoryFacts,
	type InventoryPorts,
	inventoryEvents,
} from "../inventory";
import { asWireEvent, capturingSink } from "./helpers";

const HOME = "/home/dev";

function ports(
	agents: readonly Readonly<{ name: string; version?: string }>[],
	files: Readonly<Record<string, string>>,
): InventoryPorts {
	return {
		agents: async () => agents,
		readText: (path) => files[path] ?? null,
		home: HOME,
		runtimeVersion: "2.0.0",
	};
}

const CLAUDE_SETTINGS_WITH_HOOKS = JSON.stringify({
	hooks: {
		PreToolUse: [
			{
				matcher: "*",
				hooks: [{ type: "command", command: "maina hook pre-tool-use" }],
			},
		],
	},
});

describe("collectInventory", () => {
	test("reports `hooks: missing` for an agent installed without Maina hooks", async () => {
		const facts = await collectInventory(
			ports([{ name: "claude", version: "2.3.1" }], {
				[join(HOME, ".claude", "settings.json")]: JSON.stringify({
					hooks: {
						PreToolUse: [
							{ hooks: [{ type: "command", command: "./lint.sh" }] },
						],
					},
				}),
			}),
		);
		expect(facts.agents).toEqual([
			{
				agent: "claude-code",
				version: "2.3.1",
				hooks: "missing",
				mcpServers: 0,
				plugins: 0,
			},
		]);
		const [event] = inventoryEvents(facts);
		expect(event?.data.hooksInstalled).toBe(false);
	});

	test("finds Maina's hooks, its plugin and the MCP servers per agent", async () => {
		const facts = await collectInventory(
			ports(
				[
					{ name: "claude", version: "2.3.1" },
					{ name: "codex", version: "0.44.0" },
					{ name: "cursor" },
				],
				{
					[join(HOME, ".claude", "settings.json")]: JSON.stringify({
						enabledPlugins: { "maina@mainahq": true, "other@x": true },
					}),
					[join(HOME, ".claude.json")]: JSON.stringify({
						mcpServers: { maina: {}, github: {}, linear: {} },
					}),
					[join(HOME, ".codex", "config.toml")]: [
						"[mcp_servers.maina]",
						'command = "maina"',
						"[mcp_servers.docs]",
						'command = "docs"',
						"[[hooks.PreToolUse]]",
						'command = "/usr/local/bin/maina hook pre-tool-use"',
					].join("\n"),
					[join(HOME, ".cursor", "hooks.json")]: CLAUDE_SETTINGS_WITH_HOOKS,
				},
			),
		);
		expect(facts).toEqual({
			runtimeVersion: "2.0.0",
			agents: [
				{
					agent: "claude-code",
					version: "2.3.1",
					hooks: "installed",
					mcpServers: 3,
					plugins: 1,
				},
				{
					agent: "codex",
					version: "0.44.0",
					hooks: "installed",
					mcpServers: 2,
					plugins: 0,
				},
				{ agent: "cursor", hooks: "installed", mcpServers: 0, plugins: 0 },
			],
		} satisfies InventoryFacts);
	});

	test("an unreadable or malformed config counts as nothing configured", async () => {
		const facts = await collectInventory(
			ports([{ name: "gemini", version: "0.61.0" }], {
				[join(HOME, ".gemini", "settings.json")]: "{ not json",
			}),
		);
		expect(facts.agents[0]).toMatchObject({ hooks: "missing", mcpServers: 0 });
	});
});

describe("inventoryEvents", () => {
	test("each agent's event validates against the pinned schema", async () => {
		const facts = await collectInventory(
			ports([{ name: "claude", version: "2.3.1" }, { name: "opencode" }], {
				[join(HOME, ".claude", "settings.json")]: CLAUDE_SETTINGS_WITH_HOOKS,
			}),
		);
		const events = inventoryEvents(facts).map((input) => asWireEvent(input));
		expect(events.map((e) => e.data)).toEqual([
			{
				agent: "claude-code",
				agentVersion: "2.3.1",
				mcpServers: 0,
				hooksInstalled: true,
				runtimeVersion: "2.0.0",
				plugins: 0,
			},
			{
				agent: "opencode",
				agentVersion: "unknown",
				mcpServers: 0,
				hooksInstalled: false,
				runtimeVersion: "2.0.0",
				plugins: 0,
			},
		]);
		expect(events.every((e) => e.dataClass === "metadata")).toBe(true);
	});
});

describe("createInventoryReporter", () => {
	const FACTS: InventoryFacts = {
		runtimeVersion: "2.0.0",
		agents: [
			{
				agent: "claude-code",
				version: "2.3.1",
				hooks: "installed",
				mcpServers: 1,
				plugins: 1,
			},
			{
				agent: "codex",
				version: "0.44.0",
				hooks: "missing",
				mcpServers: 0,
				plugins: 0,
			},
		],
	};

	test("reports every agent on start, then only an agent that changed", () => {
		const { sink, inputs } = capturingSink();
		const reporter = createInventoryReporter(sink);
		expect(reporter.report(FACTS)).toEqual({ ok: true, value: 2 });
		expect(reporter.report(FACTS)).toEqual({ ok: true, value: 0 });
		const [claude, codex] = FACTS.agents;
		if (claude === undefined || codex === undefined) return;
		const changed: InventoryFacts = {
			...FACTS,
			agents: [claude, { ...codex, hooks: "installed" }],
		};
		expect(reporter.report(changed)).toEqual({ ok: true, value: 1 });
		expect(inputs.map((i) => i.data.agent)).toEqual([
			"claude-code",
			"codex",
			"codex",
		]);
	});

	test("an event the sink did not queue (not enrolled) is reported again", () => {
		let enrolled = false;
		const queued: string[] = [];
		const reporter = createInventoryReporter({
			enqueue: (input) => {
				if (!enrolled) {
					return { ok: true, value: { queued: false, reason: "not_enrolled" } };
				}
				queued.push(String(input.data.agent));
				return { ok: true, value: { queued: true, eventId: "evt_1", seq: 1 } };
			},
		});
		expect(reporter.report(FACTS)).toEqual({ ok: true, value: 0 });
		enrolled = true;
		expect(reporter.report(FACTS)).toEqual({ ok: true, value: 2 });
		expect(queued).toEqual(["claude-code", "codex"]);
	});
});
