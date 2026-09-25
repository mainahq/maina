/**
 * The 1.x migration (#301, FR-INS-8).
 *
 * The fixtures reproduce what 1.8 installs left on disk: `maina init`
 * wrote `bunx`/`npx @mainahq/cli --mcp` entries (unpinned, no trailing
 * newline) into every agent's MCP file, including `.claude/settings.json`,
 * which Claude Code never reads; `maina mcp add` wrote version-pinned
 * `bunx`/`npx` entries into the hosts' global configs. The files are real,
 * inside throwaway directories.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { nodeHostFs } from "../../hosts/apply";
import type { PathContext } from "../../hosts/targets";
import {
	isStaleLaunch,
	type MigrationReport,
	migrate1x,
	migrationTargets,
} from "../migrate-1x";

// ── 1.8 install fixtures ────────────────────────────────────────────────────

/** `JSON.stringify(x, null, 2)`, no trailing newline: how 1.x wrote files. */
function v1json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

const BUNX = { command: "bunx", args: ["@mainahq/cli", "--mcp"] };
const NPX = { command: "npx", args: ["@mainahq/cli", "--mcp"] };
const OTHER_SERVER = { command: "npx", args: ["-y", "@acme/mcp-server"] };

/** Repo files a 1.8 `maina init` (plus a later `maina mcp add`) wrote. */
function repoFixture(cwd: string): Record<string, string> {
	return {
		".mcp.json": v1json({ mcpServers: { maina: BUNX } }),
		".claude/settings.json": v1json({
			permissions: { allow: ["Bash(bun test:*)"] },
			mcpServers: { maina: NPX },
		}),
		".claude/settings.local.json": v1json({ mcpServers: { maina: BUNX } }),
		".cursor/mcp.json": `${v1json({
			mcpServers: {
				acme: OTHER_SERVER,
				maina: {
					command: "/Users/dev/.bun/bin/bunx",
					args: ["@mainahq/cli@1.6.1", "--mcp"],
					env: { MAINA_LOG: "debug" },
				},
			},
		})}\n`,
		".roo/mcp.json": v1json({ mcpServers: { maina: BUNX } }),
		".amazonq/mcp.json": v1json({ mcpServers: { maina: NPX } }),
		".continue/mcpServers/maina.json": v1json({ maina: BUNX }),
		".continue/config.json": `${v1json({
			models: [],
			experimental: {
				modelContextProtocolServers: [
					{
						name: "maina",
						transport: { type: "stdio", ...BUNX },
					},
				],
			},
		})}\n`,
		// Kept: project DNA, custom prompts, config.
		".maina/constitution.md": "# Team constitution\n\n- Hand-edited.  \n",
		".maina/prompts/review.md": "# Our review prompt\n",
		".maina/prompts/custom-lint.md": "# A custom prompt\n",
		".maina/config.yml": "version: 1\n",
		".maina/unrelated.json": v1json({ note: `${cwd} @mainahq/cli --mcp` }),
	};
}

/** Global host configs a 1.8 `maina mcp add` wrote (Linux layout). */
function homeFixture(cwd: string): Record<string, string> {
	return {
		".claude.json": `${v1json({
			numStartups: 42,
			mcpServers: {
				maina: { type: "stdio", ...NPX, env: {} },
				acme: OTHER_SERVER,
			},
			projects: {
				[cwd]: {
					allowedTools: [],
					mcpServers: {
						maina: { command: "bunx", args: ["@mainahq/cli@1.4.3", "--mcp"] },
					},
				},
				"/elsewhere/repo": { allowedTools: [] },
			},
		})}\n`,
		".claude/settings.json": `${v1json({
			theme: "dark",
			mcpServers: { maina: NPX },
		})}\n`,
		".cursor/mcp.json": `${v1json({
			mcpServers: {
				maina: { command: "npx", args: ["-y", "@mainahq/cli@latest", "--mcp"] },
			},
		})}\n`,
		".codeium/windsurf/mcp_config.json": `${v1json({
			mcpServers: {
				maina: { command: "bunx", args: ["@mainahq/cli@1.8.0", "--mcp"] },
			},
		})}\n`,
		".config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json": `${v1json(
			{
				mcpServers: {
					maina: {
						command: "C:\\Program Files\\nodejs\\npx.cmd",
						args: ["@mainahq/cli", "--mcp"],
						disabled: false,
					},
				},
			},
		)}\n`,
		".codex/config.toml": [
			'model = "o3"',
			"",
			"# my servers",
			"[mcp_servers.acme]",
			'command = "acme-mcp"',
			"",
			"[mcp_servers.maina]",
			'command = "npx"',
			'args = ["@mainahq/cli@1.7.0", "--mcp"]',
			"",
			"[mcp_servers.maina.env]",
			'MAINA_LOG = "info"',
			"",
		].join("\n"),
		// Already current: not stale, must be left byte for byte.
		".gemini/settings.json": `${v1json({
			mcpServers: {
				maina: { command: "/usr/local/bin/maina", args: ["--mcp"] },
			},
		})}\n`,
		".config/zed/settings.json": `${v1json({
			theme: "One Dark",
			context_servers: {
				maina: {
					source: "custom",
					command: { path: "bunx", args: ["@mainahq/cli@1.5.0", "--mcp"] },
				},
			},
		})}\n`,
		".maina/feedback-global.txt": "keep me",
	};
}

const LAUNCHER = {
	command: "/opt/maina/bin/maina",
	args: ["--mcp"],
} as const;

// ── Harness ─────────────────────────────────────────────────────────────────

let cwd: string;
let home: string;

function write(root: string, files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
}

/** Real SQLite databases where 1.x kept them. */
function writeDatabases(root: string): void {
	for (const rel of [
		".maina/cache/cache.db",
		".maina/feedback.db",
		".maina/stats.db",
	]) {
		mkdirSync(dirname(join(root, rel)), { recursive: true });
		const db = new Database(join(root, rel));
		db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
		db.run("INSERT INTO t (v) VALUES ('@mainahq/cli --mcp')");
		db.close();
	}
}

/** Every file below `root` (relative path → bytes). */
function tree(root: string): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else out.set(relative(root, full), readFileSync(full));
		}
	};
	walk(root);
	return out;
}

function ctx(): PathContext {
	return { home, cwd, platform: "linux" };
}

function run(scope: "project" | "both" = "both"): MigrationReport {
	return migrate1x({
		ctx: ctx(),
		scope,
		launcher: LAUNCHER,
		fs: nodeHostFs(),
	});
}

function json(root: string, rel: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(root, rel), "utf-8"));
}

function entryAt(root: string, rel: string, path: readonly string[]): unknown {
	return path.reduce<unknown>(
		(cur, key) => (cur as Record<string, unknown> | undefined)?.[key],
		json(root, rel),
	);
}

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "maina-migrate-repo-"));
	home = mkdtempSync(join(tmpdir(), "maina-migrate-home-"));
	write(cwd, repoFixture(cwd));
	write(home, homeFixture(cwd));
	writeDatabases(cwd);
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
});

// ── isStaleLaunch ───────────────────────────────────────────────────────────

describe("isStaleLaunch", () => {
	test.each([
		["bunx, unpinned", BUNX],
		["npx, unpinned", NPX],
		[
			"bunx, absolute and pinned",
			{ command: "/x/bunx", args: ["@mainahq/cli@1.4.3", "--mcp"] },
		],
		[
			"npx -y @latest",
			{ command: "npx", args: ["-y", "@mainahq/cli@latest", "--mcp"] },
		],
		[
			"Windows npx.cmd",
			{ command: "C:\\nodejs\\npx.cmd", args: ["@mainahq/cli", "--mcp"] },
		],
		[
			"Zed's nested command",
			{ command: { path: "bunx", args: ["@mainahq/cli", "--mcp"] } },
		],
		[
			"Continue's transport",
			{ name: "maina", transport: { type: "stdio", ...NPX } },
		],
	])("%s is stale", (_label, entry) => {
		expect(isStaleLaunch(entry, LAUNCHER)).toBe(true);
	});

	test.each([
		["the direct binary", { command: "/usr/local/bin/maina", args: ["--mcp"] }],
		[
			"the running CLI",
			{ command: "/x/bun", args: ["/x/cli/dist/index.js", "--mcp"] },
		],
		["another package", OTHER_SERVER],
		[
			"bunx without --mcp",
			{ command: "bunx", args: ["@mainahq/cli", "verify"] },
		],
		[
			"a lookalike package",
			{ command: "npx", args: ["@mainahq/cli-extra", "--mcp"] },
		],
		["not an entry", "bunx @mainahq/cli --mcp"],
	])("%s is not stale", (_label, entry) => {
		expect(isStaleLaunch(entry, LAUNCHER)).toBe(false);
	});

	test("the launcher maina writes today is never stale, even a package runner", () => {
		const current = {
			command: "/x/bunx",
			args: ["@mainahq/cli@2.0.0", "--mcp"],
		};
		expect(
			isStaleLaunch({ ...current, args: [...current.args] }, current),
		).toBe(false);
		expect(isStaleLaunch(BUNX, current)).toBe(true);
	});
});

// ── migrationTargets ────────────────────────────────────────────────────────

describe("migrationTargets", () => {
	test("project scope never reaches into the home directory", () => {
		const targets = migrationTargets(ctx(), "project");
		expect(targets.length).toBeGreaterThan(0);
		for (const t of targets) expect(t.path.startsWith(cwd)).toBe(true);
	});

	test("covers every location 1.x wrote an MCP entry to", () => {
		const paths = new Set(migrationTargets(ctx(), "both").map((t) => t.path));
		for (const rel of Object.keys(repoFixture(cwd)).filter(
			(p) => !p.startsWith(".maina/"),
		)) {
			expect(paths).toContain(join(cwd, rel));
		}
		for (const rel of Object.keys(homeFixture(cwd)).filter(
			(p) => !p.startsWith(".maina/"),
		)) {
			expect(paths).toContain(join(home, rel));
		}
	});
});

// ── migrate1x ───────────────────────────────────────────────────────────────

describe("migrate1x", () => {
	test("removes stale MCP entries from every known location", () => {
		run();

		// No stale launch survives anywhere outside the backups.
		for (const root of [cwd, home]) {
			for (const [rel, bytes] of tree(root)) {
				if (rel.startsWith(join(".maina", "backups"))) continue;
				if (rel.endsWith(".db") || rel === join(".maina", "unrelated.json")) {
					continue;
				}
				expect({
					rel,
					stale: bytes.toString("utf-8").includes("@mainahq/cli"),
				}).toEqual({
					rel,
					stale: false,
				});
			}
		}

		// Files a host reads get today's launcher in their own shape, keeping
		// the entry's other fields.
		expect(entryAt(cwd, ".mcp.json", ["mcpServers", "maina"])).toEqual(
			LAUNCHER,
		);
		expect(entryAt(cwd, ".cursor/mcp.json", ["mcpServers"])).toEqual({
			acme: OTHER_SERVER,
			maina: { ...LAUNCHER, env: { MAINA_LOG: "debug" } },
		});
		expect(entryAt(cwd, ".roo/mcp.json", ["mcpServers", "maina"])).toEqual(
			LAUNCHER,
		);
		expect(entryAt(cwd, ".amazonq/mcp.json", ["mcpServers", "maina"])).toEqual(
			LAUNCHER,
		);
		expect(entryAt(cwd, ".continue/mcpServers/maina.json", ["maina"])).toEqual(
			LAUNCHER,
		);
		expect(
			entryAt(cwd, ".continue/config.json", [
				"experimental",
				"modelContextProtocolServers",
			]),
		).toEqual([{ name: "maina", transport: { type: "stdio", ...LAUNCHER } }]);
		expect(entryAt(home, ".claude.json", ["mcpServers"])).toEqual({
			maina: { type: "stdio", ...LAUNCHER, env: {} },
			acme: OTHER_SERVER,
		});
		expect(
			entryAt(home, ".claude.json", ["projects", cwd, "mcpServers", "maina"]),
		).toEqual(LAUNCHER);
		expect(entryAt(home, ".claude.json", ["numStartups"])).toBe(42);
		expect(
			entryAt(home, ".config/zed/settings.json", ["context_servers", "maina"]),
		).toEqual({
			source: "custom",
			command: { path: LAUNCHER.command, args: [...LAUNCHER.args] },
		});
		const codex = readFileSync(join(home, ".codex/config.toml"), "utf-8");
		expect(codex).toStartWith(
			'model = "o3"\n\n# my servers\n[mcp_servers.acme]\n',
		);
		expect(codex).toContain(`command = "${LAUNCHER.command}"`);
		expect(codex).toContain('MAINA_LOG = "info"');

		// Files no host reads lose the entry; a file holding nothing else goes.
		expect(json(cwd, ".claude/settings.json")).toEqual({
			permissions: { allow: ["Bash(bun test:*)"] },
			mcpServers: {},
		});
		expect(existsSync(join(cwd, ".claude/settings.local.json"))).toBe(false);
		expect(json(home, ".claude/settings.json")).toEqual({
			theme: "dark",
			mcpServers: {},
		});
	});

	test("keeps the constitution, custom prompts and databases", () => {
		const before = tree(join(cwd, ".maina"));
		run();
		const after = tree(join(cwd, ".maina"));
		for (const [rel, bytes] of before) {
			expect({ rel, same: after.get(rel)?.equals(bytes) }).toEqual({
				rel,
				same: true,
			});
		}
		// The only additions are backups.
		for (const rel of after.keys()) {
			if (!before.has(rel)) expect(rel).toStartWith("backups");
		}
		expect(
			readFileSync(join(home, ".maina/feedback-global.txt"), "utf-8"),
		).toBe("keep me");
	});

	test("backs up every file before changing it, keeping the first copy", () => {
		const original = readFileSync(join(cwd, ".mcp.json"), "utf-8");
		const report = run();
		expect(readFileSync(join(cwd, ".maina/backups/.mcp.json"), "utf-8")).toBe(
			original,
		);
		for (const change of report.changes) {
			expect(change.backup).not.toBeNull();
			expect(existsSync(change.backup as string)).toBe(true);
		}
		expect(
			existsSync(join(cwd, ".maina/backups/.claude/settings.local.json")),
		).toBe(true);
	});

	test("is idempotent", () => {
		const first = run();
		expect(first.changes.length).toBeGreaterThan(0);
		const repo = tree(cwd);
		const homeFiles = tree(home);

		const second = run();
		expect(second).toEqual({ changes: [], skipped: [] });
		expect(tree(cwd)).toEqual(repo);
		expect(tree(home)).toEqual(homeFiles);
	});

	test("the report lists every change", () => {
		const report = run();
		const rows = report.changes.map((c) => [
			c.scope,
			relative(c.scope === "project" ? cwd : home, c.path),
			c.action,
		]);
		expect(rows.sort()).toEqual(
			[
				["project", ".mcp.json", "rewritten"],
				["project", ".cursor/mcp.json", "rewritten"],
				["project", ".continue/config.json", "rewritten"],
				["project", ".roo/mcp.json", "rewritten"],
				["project", ".amazonq/mcp.json", "rewritten"],
				["project", ".continue/mcpServers/maina.json", "rewritten"],
				["project", ".claude/settings.json", "removed"],
				["project", ".claude/settings.local.json", "deleted"],
				["global", ".claude.json", "rewritten"],
				["global", ".claude.json", "rewritten"],
				["global", ".claude/settings.json", "removed"],
				["global", ".cursor/mcp.json", "rewritten"],
				["global", ".codeium/windsurf/mcp_config.json", "rewritten"],
				[
					"global",
					".config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
					"rewritten",
				],
				["global", ".codex/config.toml", "rewritten"],
				["global", ".config/zed/settings.json", "rewritten"],
			].sort(),
		);
		expect(report.skipped).toEqual([]);

		const mcp = report.changes.find((c) => c.path === join(cwd, ".mcp.json"));
		expect(mcp?.from).toBe("bunx @mainahq/cli --mcp");
		expect(mcp?.to).toBe("/opt/maina/bin/maina --mcp");
		const local = report.changes.find(
			(c) => c.path === join(cwd, ".claude/settings.local.json"),
		);
		expect(local?.to).toBeNull();
	});

	test("project scope leaves global configs alone", () => {
		const homeFiles = tree(home);
		const report = run("project");
		expect(report.changes.every((c) => c.scope === "project")).toBe(true);
		expect(tree(home)).toEqual(homeFiles);
	});

	test("an unparseable file that mentions maina is reported, not touched", () => {
		const broken =
			'{ "mcpServers": { "maina": { "command": "bunx", "args": ["@mainahq/cli", "--mcp"] } ';
		writeFileSync(join(cwd, ".mcp.json"), broken);
		const report = run("project");
		expect(readFileSync(join(cwd, ".mcp.json"), "utf-8")).toBe(broken);
		expect(report.skipped).toEqual([
			{ path: join(cwd, ".mcp.json"), reason: "malformed JSON" },
		]);
	});
});
