/**
 * Host config targets (FR-INS-4): which file each host actually reads.
 *
 * P1 was an installer writing a file the host never reads. Claude Code
 * reads MCP servers from `<repo>/.mcp.json` (project scope) and
 * `~/.claude.json` (user scope) — never from any `settings.json`.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { listClientIds } from "../clients";
import { targetsFor } from "../targets";

const ctx = { home: "/h", cwd: "/p", platform: "linux" as const };

describe("targetsFor", () => {
	test("a Claude entry never goes to settings.json, in any scope", () => {
		for (const scope of ["global", "project", "both"] as const) {
			for (const t of targetsFor("claude", scope, ctx)) {
				expect(t.path).not.toMatch(/settings(\.local)?\.json$/);
			}
		}
	});

	test("Claude project scope is <repo>/.mcp.json, user scope is ~/.claude.json", () => {
		expect(targetsFor("claude", "project", ctx).map((t) => t.path)).toEqual([
			join("/p", ".mcp.json"),
		]);
		expect(targetsFor("claude", "global", ctx).map((t) => t.path)).toEqual([
			join("/h", ".claude.json"),
		]);
		for (const t of targetsFor("claude", "both", ctx)) {
			expect(t.containerPath).toEqual(["mcpServers"]);
			expect(t.entryKey).toBe("maina");
			expect(t.format).toBe("json");
		}
	});

	test("both = global then project, and each carries its scope", () => {
		const both = targetsFor("cursor", "both", ctx);
		expect(both.map((t) => [t.scope, t.path])).toEqual([
			["global", join("/h", ".cursor", "mcp.json")],
			["project", join("/p", ".cursor", "mcp.json")],
		]);
	});

	test("Codex reads $CODEX_HOME/config.toml, default ~/.codex", () => {
		expect(targetsFor("codex", "global", ctx)[0]?.path).toBe(
			join("/h", ".codex", "config.toml"),
		);
		expect(
			targetsFor("codex", "global", { ...ctx, codexHome: "/ch" })[0]?.path,
		).toBe(join("/ch", "config.toml"));
		expect(targetsFor("codex", "global", ctx)[0]?.format).toBe("toml");
		expect(targetsFor("codex", "global", ctx)[0]?.containerPath).toEqual([
			"mcp_servers",
		]);
	});

	test("a host without a project config has no project target", () => {
		expect(targetsFor("codex", "project", ctx)).toEqual([]);
		expect(targetsFor("windsurf", "project", ctx)).toEqual([]);
	});

	test("backups live under .maina/backups: the repo's for project, ~'s for global", () => {
		const [project] = targetsFor("claude", "project", ctx);
		expect(project?.backupPath).toBe(
			join("/p", ".maina", "backups", ".mcp.json"),
		);
		const [global] = targetsFor("claude", "global", ctx);
		expect(global?.backupPath).toBe(
			join("/h", ".maina", "backups", "global", ".claude.json"),
		);
	});

	test("every host has exactly one global target and backup paths never collide", () => {
		const seen = new Set<string>();
		for (const id of listClientIds()) {
			const targets = targetsFor(id, "both", ctx);
			expect(targets.filter((t) => t.scope === "global")).toHaveLength(1);
			for (const t of targets) {
				expect(seen.has(t.backupPath)).toBe(false);
				seen.add(t.backupPath);
				expect(t.backupPath).not.toBe(t.path);
			}
		}
	});
});
