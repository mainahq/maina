/**
 * `maina mcp add` / `remove` against a throwaway HOME (FR-INS-4, P1, P8).
 *
 * The contract a user sees on disk:
 *   - Claude Code's entry lands in `~/.claude.json` / `<repo>/.mcp.json`,
 *     never `settings.json` (P1);
 *   - every unrelated key survives the merge (P8);
 *   - the original is backed up once;
 *   - remove puts back exactly what was there before.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdd, runRemove, runSetupHosts } from "../index";
import { detectLauncher, resetLauncherCache } from "../launcher";

let HOME: string;
let CWD: string;

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), "maina-host-config-"));
	HOME = join(root, "home");
	CWD = join(root, "project");
	mkdirSync(HOME, { recursive: true });
	mkdirSync(CWD, { recursive: true });
	resetLauncherCache();
	detectLauncher({ which: () => null, self: null });
});

afterEach(() => {
	rmSync(join(HOME, ".."), { recursive: true, force: true });
	resetLauncherCache();
});

const read = (p: string) => readFileSync(p, "utf-8");

const CLAUDE_SETTINGS = `${JSON.stringify(
	{
		hooks: {
			PreToolUse: [
				{ matcher: "Bash", hooks: [{ type: "command", command: "g.sh" }] },
			],
		},
		permissions: { allow: ["Bash(ls:*)"] },
	},
	null,
	2,
)}\n`;

describe("maina mcp add --client claude", () => {
	test("writes ~/.claude.json and never touches settings.json", async () => {
		mkdirSync(join(HOME, ".claude"), { recursive: true });
		const settings = join(HOME, ".claude", "settings.json");
		writeFileSync(settings, CLAUDE_SETTINGS);

		const r = await runAdd({
			clients: ["claude"],
			scope: "both",
			dryRun: false,
			cwd: CWD,
			home: HOME,
		});
		expect(r.results.map((x) => x.configPath).sort()).toEqual(
			[join(HOME, ".claude.json"), join(CWD, ".mcp.json")].sort(),
		);
		expect(read(settings)).toBe(CLAUDE_SETTINGS);
		expect(existsSync(join(CWD, ".claude", "settings.json"))).toBe(false);
		const user = JSON.parse(read(join(HOME, ".claude.json")));
		expect(user.mcpServers.maina.args).toContain("--mcp");
	});

	test("merging ~/.claude.json keeps every unrelated key and backs it up once", async () => {
		const path = join(HOME, ".claude.json");
		const before = `${JSON.stringify(
			{
				numStartups: 7,
				hooks: { Stop: [] },
				permissions: { deny: ["Read(.env)"] },
				projects: { [CWD]: { allowedTools: ["x"] } },
				mcpServers: { memory: { command: "mem" } },
			},
			null,
			2,
		)}\n`;
		writeFileSync(path, before);
		const opts = {
			clients: ["claude" as const],
			scope: "global" as const,
			dryRun: false,
			cwd: CWD,
			home: HOME,
		};

		const first = await runAdd(opts);
		expect(first.results[0]?.action).toBe("updated");
		const merged = JSON.parse(read(path));
		const { maina, ...others } = merged.mcpServers;
		expect(maina).toBeDefined();
		expect({ ...merged, mcpServers: others }).toEqual(JSON.parse(before));

		const backup = join(HOME, ".maina", "backups", "global", ".claude.json");
		expect(read(backup)).toBe(before);

		// A second install (same entry) and a later edit leave the backup alone.
		await runAdd(opts);
		writeFileSync(
			path,
			read(path).replace('"numStartups": 7', '"numStartups": 8'),
		);
		resetLauncherCache();
		detectLauncher({ which: () => "/opt/bin/maina", self: null });
		await runAdd(opts);
		expect(read(backup)).toBe(before);
	});

	test("remove restores the pre-maina bytes exactly and drops the backup", async () => {
		const path = join(HOME, ".claude.json");
		const before =
			'{"numStartups":1,"hooks":{},"mcpServers":{"m":{"command":"m"}}}';
		writeFileSync(path, before);
		const opts = {
			clients: ["claude" as const],
			scope: "global" as const,
			dryRun: false,
			cwd: CWD,
			home: HOME,
		};
		await runAdd(opts);
		expect(read(path)).not.toBe(before);
		const r = await runRemove(opts);
		expect(r.results[0]?.action).toBe("restored");
		expect(read(path)).toBe(before);
		expect(
			existsSync(join(HOME, ".maina", "backups", "global", ".claude.json")),
		).toBe(false);
	});

	test("remove deletes a config file maina created", async () => {
		const opts = {
			clients: ["cursor" as const],
			scope: "global" as const,
			dryRun: false,
			cwd: CWD,
			home: HOME,
		};
		await runAdd(opts);
		expect(existsSync(join(HOME, ".cursor", "mcp.json"))).toBe(true);
		await runRemove(opts);
		expect(existsSync(join(HOME, ".cursor", "mcp.json"))).toBe(false);
	});

	test("a symlinked config (dotfiles) is written through, not replaced", async () => {
		const real = join(HOME, "dotfiles", "claude.json");
		mkdirSync(join(HOME, "dotfiles"), { recursive: true });
		writeFileSync(real, '{"a":1}\n');
		symlinkSync(real, join(HOME, ".claude.json"));
		await runAdd({
			clients: ["claude"],
			scope: "global",
			dryRun: false,
			cwd: CWD,
			home: HOME,
		});
		expect(JSON.parse(read(real)).mcpServers.maina).toBeDefined();
		expect(read(join(HOME, ".claude.json"))).toBe(read(real));
	});

	test("a private (0600) config stays private, and so does its backup", async () => {
		const path = join(HOME, ".cursor", "mcp.json");
		mkdirSync(join(HOME, ".cursor"), { recursive: true });
		writeFileSync(path, '{"mcpServers":{"k":{"env":{"KEY":"secret"}}}}\n', {
			mode: 0o600,
		});
		chmodSync(path, 0o600);
		await runAdd({
			clients: ["cursor"],
			scope: "global",
			dryRun: false,
			cwd: CWD,
			home: HOME,
		});
		expect(statSync(path).mode & 0o777).toBe(0o600);
		const backup = join(
			HOME,
			".maina",
			"backups",
			"global",
			".cursor",
			"mcp.json",
		);
		expect(statSync(backup).mode & 0o777).toBe(0o600);
	});

	test("dry-run reports the action and writes nothing, not even a backup", async () => {
		writeFileSync(join(HOME, ".claude.json"), "{}\n");
		const r = await runAdd({
			clients: ["claude"],
			scope: "global",
			dryRun: true,
			cwd: CWD,
			home: HOME,
		});
		expect(r.results[0]?.action).toBe("updated");
		expect(read(join(HOME, ".claude.json"))).toBe("{}\n");
		expect(existsSync(join(HOME, ".maina"))).toBe(false);
	});

	test("a malformed config is reported and left as it is", async () => {
		writeFileSync(join(HOME, ".claude.json"), "{ nope");
		const r = await runAdd({
			clients: ["claude"],
			scope: "global",
			dryRun: false,
			cwd: CWD,
			home: HOME,
		});
		expect(r.results[0]?.error).toBeDefined();
		expect(read(join(HOME, ".claude.json"))).toBe("{ nope");
	});
});

describe("runSetupHosts (what `maina setup` registers globally)", () => {
	test("writes Codex's ~/.codex/config.toml when Codex is installed, keeping the rest", async () => {
		mkdirSync(join(HOME, ".codex"), { recursive: true });
		const before = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "o"\n';
		writeFileSync(join(HOME, ".codex", "config.toml"), before);
		const r = await runSetupHosts({ home: HOME, cwd: CWD });
		const codex = r.results.find((x) => x.clientId === "codex");
		expect(codex?.action).toBe("updated");
		const out = read(join(HOME, ".codex", "config.toml"));
		expect(out.startsWith(before)).toBe(true);
		expect(out).toContain("[mcp_servers.maina]");
	});

	test("skips hosts that are not installed and hosts setup wires per project", async () => {
		mkdirSync(join(HOME, ".claude"), { recursive: true });
		mkdirSync(join(HOME, ".cursor"), { recursive: true });
		const r = await runSetupHosts({ home: HOME, cwd: CWD });
		// Claude Code and Cursor get the project files from onboarding.
		expect(r.results.map((x) => x.clientId)).not.toContain("claude");
		expect(r.results.map((x) => x.clientId)).not.toContain("cursor");
		expect(existsSync(join(HOME, ".claude.json"))).toBe(false);
		expect(existsSync(join(HOME, ".codex"))).toBe(false);
	});
});
