/**
 * Apply tests for the MCP add/remove machinery.
 *
 * Each test runs against a tmpdir-rooted fake $HOME so we never touch the
 * developer's actual ~/.claude or ~/.cursor configs. The non-destructive
 * merge contract — preserve other servers, preserve unrelated keys — is
 * the most important behaviour to lock down here.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as toml from "@iarna/toml";
import { addOnClient, inspectClient, removeFromClient } from "../apply";
import { buildClientRegistry } from "../clients";

let HOME: string;

beforeEach(() => {
	HOME = join(
		tmpdir(),
		`maina-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(HOME, { recursive: true });
});

afterEach(() => {
	rmSync(HOME, { recursive: true, force: true });
});

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

// ── add: object-shaped clients (Claude / Cursor / etc.) ────────────────────

describe("addOnClient — JSON object shape (Cursor, Claude, etc.)", () => {
	test("creates the config file when missing and inserts the maina entry", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		const r = await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});

		expect(r.action).toBe("created");
		const json = readJson(path);
		expect((json.mcpServers as Record<string, unknown>).maina).toEqual({
			command: "npx",
			args: ["@mainahq/cli", "--mcp"],
		});
	});

	test("preserves existing servers and unrelated config keys", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		mkdirSync(join(HOME, ".cursor"), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify(
				{
					theme: "dark",
					mcpServers: {
						posthog: {
							command: "npx",
							args: ["mcp-remote@latest", "https://x"],
						},
					},
				},
				null,
				2,
			),
		);

		await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});

		const json = readJson(path);
		expect(json.theme).toBe("dark");
		const servers = json.mcpServers as Record<string, unknown>;
		expect(servers.posthog).toBeDefined();
		expect(servers.maina).toBeDefined();
	});

	test("re-running with the same entry returns 'unchanged'", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		const second = await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		expect(second.action).toBe("unchanged");
	});

	test("dryRun=true never writes the file", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		const r = await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: true,
		});
		expect(r.action).toBe("created");
		expect(existsSync(path)).toBe(false);
	});

	test("malformed existing JSON surfaces an error and does not overwrite", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		mkdirSync(join(HOME, ".cursor"), { recursive: true });
		writeFileSync(path, "{ not json");

		const r = await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		expect(r.error).toBeDefined();
		// Original content preserved.
		expect(readFileSync(path, "utf-8")).toBe("{ not json");
	});
});

// ── add: array-shaped client (Continue legacy) ─────────────────────────────

describe("addOnClient — JSON array shape (Continue)", () => {
	test("appends to the experimental.modelContextProtocolServers array", async () => {
		const info = buildClientRegistry(HOME).continue;
		const path = info.globalConfigPath();
		const r = await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});

		expect(r.action).toBe("created");
		const json = readJson(path);
		const arr = (json.experimental as Record<string, unknown>)
			.modelContextProtocolServers as Array<{ name: string }>;
		expect(arr.length).toBe(1);
		expect(arr[0]?.name).toBe("maina");
	});

	test("idempotent for arrays — re-running yields 'unchanged'", async () => {
		const info = buildClientRegistry(HOME).continue;
		const path = info.globalConfigPath();
		await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		const second = await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		expect(second.action).toBe("unchanged");
	});
});

// ── add: TOML client (Codex) ───────────────────────────────────────────────

describe("addOnClient — TOML shape (Codex)", () => {
	test("writes a TOML file with [mcp_servers.maina] section", async () => {
		const info = buildClientRegistry(HOME).codex;
		const path = info.globalConfigPath();
		const r = await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});

		expect(r.action).toBe("created");
		const parsed = toml.parse(readFileSync(path, "utf-8")) as Record<
			string,
			unknown
		>;
		const section = (parsed.mcp_servers as Record<string, unknown>)
			.maina as Record<string, unknown>;
		expect(section.command).toBe("npx");
		expect(section.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("preserves other TOML sections", async () => {
		const info = buildClientRegistry(HOME).codex;
		const path = info.globalConfigPath();
		mkdirSync(join(HOME, ".codex"), { recursive: true });
		writeFileSync(
			path,
			'model = "gpt-4o"\n[mcp_servers.other]\ncommand = "x"\n',
		);

		await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});

		const parsed = toml.parse(readFileSync(path, "utf-8")) as Record<
			string,
			unknown
		>;
		expect(parsed.model).toBe("gpt-4o");
		const servers = parsed.mcp_servers as Record<string, unknown>;
		expect(servers.other).toBeDefined();
		expect(servers.maina).toBeDefined();
	});
});

// ── remove ─────────────────────────────────────────────────────────────────

describe("removeFromClient", () => {
	test("removes only the maina entry, preserves other servers", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		mkdirSync(join(HOME, ".cursor"), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				mcpServers: {
					maina: { command: "npx", args: ["@mainahq/cli", "--mcp"] },
					posthog: { command: "npx", args: ["other"] },
				},
			}),
		);

		const r = await removeFromClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		expect(r.action).toBe("removed");
		const servers = readJson(path).mcpServers as Record<string, unknown>;
		expect(servers.maina).toBeUndefined();
		expect(servers.posthog).toBeDefined();
	});

	test("returns 'absent' when the file does not exist", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const r = await removeFromClient(info, {
			configPath: info.globalConfigPath(),
			scope: "global",
			dryRun: false,
		});
		expect(r.action).toBe("absent");
	});

	test("returns 'absent' when the entry was never added", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		mkdirSync(join(HOME, ".cursor"), { recursive: true });
		writeFileSync(path, JSON.stringify({ mcpServers: { other: {} } }));

		const r = await removeFromClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		expect(r.action).toBe("absent");
	});

	test("removes from Continue's array and leaves siblings alone", async () => {
		const info = buildClientRegistry(HOME).continue;
		const path = info.globalConfigPath();
		mkdirSync(join(HOME, ".continue"), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				experimental: {
					modelContextProtocolServers: [
						{ name: "maina", transport: { type: "stdio" } },
						{ name: "posthog", transport: { type: "stdio" } },
					],
				},
			}),
		);
		const r = await removeFromClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		expect(r.action).toBe("removed");
		const arr = (readJson(path).experimental as Record<string, unknown>)
			.modelContextProtocolServers as Array<{ name: string }>;
		expect(arr.length).toBe(1);
		expect(arr[0]?.name).toBe("posthog");
	});
});

// ── inspect ────────────────────────────────────────────────────────────────

describe("inspectClient", () => {
	test("reports installed=true after add()", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const path = info.globalConfigPath();
		await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		const status = await inspectClient(info, path);
		expect(status.installed).toBe(true);
	});

	test("reports installed=false when the file is absent", async () => {
		const info = buildClientRegistry(HOME).cursor;
		const status = await inspectClient(info, info.globalConfigPath());
		expect(status.installed).toBe(false);
	});

	test("works for Continue's array shape", async () => {
		const info = buildClientRegistry(HOME).continue;
		const path = info.globalConfigPath();
		await addOnClient(info, {
			configPath: path,
			scope: "global",
			dryRun: false,
		});
		const status = await inspectClient(info, path);
		expect(status.installed).toBe(true);
	});
});
