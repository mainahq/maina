/**
 * `maina statusline install|remove|preview` (FR-RET-1, #347).
 *
 * The status line is one managed key, `statusLine`, in a Claude Code
 * settings file. Install and remove are keyed JSON merges: every other byte
 * of the user's settings stays as it was, and a status line that is not
 * maina's is never replaced or removed.
 */

import { describe, expect, test } from "bun:test";
import type { HostFs } from "../../hosts/apply";
import {
	runStatusline,
	type StatuslinePorts,
	statuslineSettingsPath,
	withoutStatusline,
	withStatusline,
} from "../statusline";

const COMMAND = "/opt/maina/bin/maina cli statusline";

const USER_SETTINGS = `${JSON.stringify(
	{
		model: "opus",
		permissions: { allow: ["Bash(ls:*)"], deny: [] },
		hooks: { PreToolUse: [] },
		env: { FOO: "bar" },
	},
	null,
	2,
)}\n`;

type Fake = Readonly<{
	ports: StatuslinePorts;
	files: Map<string, string>;
	out: string[];
	err: string[];
}>;

function memoryFs(files: Map<string, string>): HostFs {
	return {
		read: (path) => ({ ok: true, value: files.get(path) ?? null }),
		write: (path, content) => {
			files.set(path, content);
			return { ok: true, value: undefined };
		},
		create: (path, content) => {
			if (files.has(path)) return { ok: true, value: "exists" };
			files.set(path, content);
			return { ok: true, value: "created" };
		},
		remove: (path) => {
			files.delete(path);
			return { ok: true, value: undefined };
		},
	};
}

function fake(
	overrides: Partial<StatuslinePorts> = {},
	files = new Map<string, string>(),
): Fake {
	const out: string[] = [];
	const err: string[] = [];
	const ports: StatuslinePorts = {
		render: async () => "Maina: on",
		readStdin: async () => "",
		stdout: (text) => out.push(text),
		stderr: (text) => err.push(text),
		fs: memoryFs(files),
		home: "/home/u",
		cwd: "/repo",
		command: COMMAND,
		...overrides,
	};
	return { ports, files, out, err };
}

describe("withStatusline / withoutStatusline", () => {
	test("install then remove leaves the user's settings byte-identical", () => {
		const installed = withStatusline(USER_SETTINGS, COMMAND);
		expect(installed.kind).toBe("write");
		if (installed.kind !== "write") return;
		expect(JSON.parse(installed.text).statusLine).toEqual({
			type: "command",
			command: COMMAND,
			padding: 0,
		});
		const removed = withoutStatusline(installed.text);
		expect(removed.kind).toBe("write");
		if (removed.kind !== "write") return;
		expect(removed.text).toBe(USER_SETTINGS);
	});

	test("keeps tab indentation and a missing trailing newline", () => {
		const text = JSON.stringify({ theme: "dark", env: { A: "1" } }, null, "\t");
		const installed = withStatusline(text, COMMAND);
		if (installed.kind !== "write") throw new Error(installed.kind);
		expect(installed.text).toContain('\n\t"statusLine": {');
		const removed = withoutStatusline(installed.text);
		if (removed.kind !== "write") throw new Error(removed.kind);
		expect(removed.text).toBe(text);
	});

	test("installs into a missing or empty file", () => {
		for (const text of [null, ""]) {
			const installed = withStatusline(text, COMMAND);
			if (installed.kind !== "write") throw new Error(installed.kind);
			expect(JSON.parse(installed.text)).toEqual({
				statusLine: { type: "command", command: COMMAND, padding: 0 },
			});
		}
	});

	test("a second install changes nothing", () => {
		const installed = withStatusline(USER_SETTINGS, COMMAND);
		if (installed.kind !== "write") throw new Error(installed.kind);
		expect(withStatusline(installed.text, COMMAND).kind).toBe("unchanged");
	});

	test("an install moves maina's own entry to a new command", () => {
		const first = withStatusline(USER_SETTINGS, COMMAND);
		if (first.kind !== "write") throw new Error(first.kind);
		const next = withStatusline(first.text, "maina cli statusline");
		if (next.kind !== "write") throw new Error(next.kind);
		expect(JSON.parse(next.text).statusLine.command).toBe(
			"maina cli statusline",
		);
	});

	test("never replaces a status line that is not maina's", () => {
		const theirs = `${JSON.stringify(
			{ statusLine: { type: "command", command: "~/bin/my-line.sh" } },
			null,
			2,
		)}\n`;
		const installed = withStatusline(theirs, COMMAND);
		expect(installed.kind).toBe("refused");
		if (installed.kind !== "refused") return;
		expect(installed.reason).toContain("~/bin/my-line.sh");
	});

	test("never removes a status line that is not maina's", () => {
		const theirs = `${JSON.stringify({ statusLine: { type: "command", command: "starship" } }, null, 2)}\n`;
		expect(withoutStatusline(theirs).kind).toBe("refused");
	});

	test("remove with no status line changes nothing", () => {
		expect(withoutStatusline(USER_SETTINGS).kind).toBe("unchanged");
		expect(withoutStatusline(null).kind).toBe("unchanged");
	});

	test("malformed settings are refused, never rewritten", () => {
		expect(withStatusline("{ nope", COMMAND).kind).toBe("refused");
		expect(withoutStatusline("[1, 2]").kind).toBe("refused");
	});
});

describe("statuslineSettingsPath", () => {
	test("maps each scope to the Claude Code settings file", () => {
		const where = { home: "/home/u", cwd: "/repo" };
		expect(statuslineSettingsPath("user", where)).toBe(
			"/home/u/.claude/settings.json",
		);
		expect(statuslineSettingsPath("project", where)).toBe(
			"/repo/.claude/settings.json",
		);
		expect(statuslineSettingsPath("local", where)).toBe(
			"/repo/.claude/settings.local.json",
		);
	});
});

describe("runStatusline", () => {
	test("no subcommand renders the host's stdin to one line", async () => {
		const seen: string[] = [];
		const f = fake({
			readStdin: async () => '{"session_id":"s1"}',
			render: async (input) => {
				seen.push(input);
				return "Maina: on · 1 blocked";
			},
		});
		expect(await runStatusline([], f.ports)).toBe(0);
		expect(seen).toEqual(['{"session_id":"s1"}']);
		expect(f.out.join("")).toBe("Maina: on · 1 blocked\n");
	});

	test("a render that fails prints Maina: off and still exits 0", async () => {
		const f = fake({
			render: async () => {
				throw new Error("boom");
			},
		});
		expect(await runStatusline([], f.ports)).toBe(0);
		expect(f.out.join("")).toBe("Maina: off\n");
		expect(f.err).toEqual([]);
	});

	test("unreadable stdin still renders", async () => {
		const f = fake({
			readStdin: async () => {
				throw new Error("closed");
			},
		});
		expect(await runStatusline([], f.ports)).toBe(0);
		expect(f.out.join("")).toBe("Maina: on\n");
	});

	test("preview renders without reading stdin", async () => {
		let read = false;
		const f = fake({
			readStdin: async () => {
				read = true;
				return "";
			},
		});
		expect(await runStatusline(["preview"], f.ports)).toBe(0);
		expect(read).toBe(false);
		expect(f.out.join("")).toBe("Maina: on\n");
	});

	test("install writes the local settings by default, remove undoes it", async () => {
		const path = "/repo/.claude/settings.local.json";
		const f = fake({}, new Map([[path, USER_SETTINGS]]));
		expect(await runStatusline(["install"], f.ports)).toBe(0);
		expect(JSON.parse(f.files.get(path) ?? "").statusLine.command).toBe(
			COMMAND,
		);
		expect(await runStatusline(["remove"], f.ports)).toBe(0);
		expect(f.files.get(path)).toBe(USER_SETTINGS);
	});

	test("install honours --scope and --command", async () => {
		const f = fake();
		const code = await runStatusline(
			["install", "--scope", "user", "--command", "maina cli statusline"],
			f.ports,
		);
		expect(code).toBe(0);
		const text = f.files.get("/home/u/.claude/settings.json") ?? "";
		expect(JSON.parse(text).statusLine.command).toBe("maina cli statusline");
	});

	test("a refused install writes nothing and exits 1", async () => {
		const path = "/repo/.claude/settings.local.json";
		const theirs = '{"statusLine":{"type":"command","command":"starship"}}';
		const f = fake({}, new Map([[path, theirs]]));
		expect(await runStatusline(["install"], f.ports)).toBe(1);
		expect(f.files.get(path)).toBe(theirs);
		expect(f.err.join("")).toContain("starship");
	});

	test("an unknown scope or subcommand is a usage error", async () => {
		const f = fake();
		expect(await runStatusline(["install", "--scope", "team"], f.ports)).toBe(
			64,
		);
		expect(await runStatusline(["frobnicate"], f.ports)).toBe(64);
		expect(f.files.size).toBe(0);
	});

	test("install backs up the settings once before its first write", async () => {
		const path = "/repo/.claude/settings.local.json";
		const backup = "/repo/.maina/backups/.claude/settings.local.json";
		const f = fake({}, new Map([[path, USER_SETTINGS]]));
		expect(await runStatusline(["install"], f.ports)).toBe(0);
		expect(f.files.get(backup)).toBe(USER_SETTINGS);
		expect(await runStatusline(["remove"], f.ports)).toBe(0);
		expect(
			await runStatusline(["install", "--command", "maina x"], f.ports),
		).toBe(0);
		expect(f.files.get(backup)).toBe(USER_SETTINGS);
	});

	test("a user-scope backup goes under ~/.maina/backups/global", async () => {
		const path = "/home/u/.claude/settings.json";
		const f = fake({}, new Map([[path, USER_SETTINGS]]));
		expect(await runStatusline(["install", "--scope", "user"], f.ports)).toBe(
			0,
		);
		expect(
			f.files.get("/home/u/.maina/backups/global/.claude/settings.json"),
		).toBe(USER_SETTINGS);
	});

	test("a new settings file needs no backup", async () => {
		const f = fake();
		expect(await runStatusline(["install"], f.ports)).toBe(0);
		expect([...f.files.keys()]).toEqual(["/repo/.claude/settings.local.json"]);
	});

	test("a failed write is reported, not thrown", async () => {
		const files = new Map<string, string>();
		const f = fake({
			fs: {
				...memoryFs(files),
				write: () => ({ ok: false, error: "EACCES" }),
			},
		});
		expect(await runStatusline(["install"], f.ports)).toBe(1);
		expect(f.err.join("")).toContain("EACCES");
	});
});
