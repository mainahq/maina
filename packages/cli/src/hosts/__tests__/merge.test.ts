/**
 * `mergeEntry` (FR-INS-4, P8): add the maina entry to a host config file
 * without overwriting anything else in it.
 *
 * Pure: the current bytes (and any existing backup) come in as a
 * snapshot, a single `FileOp` describing the write comes out.
 */

import { describe, expect, test } from "bun:test";
import * as toml from "@iarna/toml";
import { deleteEntry, mergeEntry, setEntry } from "../merge";
import { type TargetFile, targetsFor } from "../targets";
import { removeEntry } from "../uninstall";

const ctx = { home: "/h", cwd: "/p", platform: "linux" as const };
const ENTRY = { command: "/usr/local/bin/maina", args: ["--mcp"] };

function target(
	host: Parameters<typeof targetsFor>[0],
	scope: "global" | "project",
): TargetFile {
	const t = targetsFor(host, scope, ctx)[0];
	if (t === undefined) throw new Error(`no ${scope} target for ${host}`);
	return t;
}

const claudeUser = target("claude", "global");
const claudeProject = target("claude", "project");
const codex = target("codex", "global");
const continueGlobal = target("continue", "global");

/** A real-looking `~/.claude.json`: hooks, permissions, projects, servers. */
const CLAUDE_JSON = `${JSON.stringify(
	{
		numStartups: 42,
		hooks: {
			PreToolUse: [
				{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] },
			],
		},
		permissions: { allow: ["Bash(ls:*)"], deny: ["Read(.env)"] },
		projects: { "/p": { allowedTools: [], mcpServers: {} } },
		mcpServers: { memory: { command: "mem", args: ["--x"], env: { A: "1" } } },
	},
	null,
	2,
)}\n`;

describe("mergeEntry — JSON object containers", () => {
	test("merging preserves every unrelated key, including hooks and permissions", () => {
		const op = mergeEntry(claudeUser, ENTRY, {
			text: CLAUDE_JSON,
			backup: null,
		});
		expect(op.action).toBe("updated");
		expect(typeof op.content).toBe("string");
		const before = JSON.parse(CLAUDE_JSON);
		const after = JSON.parse(op.content as string);
		expect(after).toEqual({
			...before,
			mcpServers: { ...before.mcpServers, maina: ENTRY },
		});
		// Byte-level: only the maina key is new.
		const withoutMaina = JSON.parse(op.content as string);
		delete withoutMaina.mcpServers.maina;
		expect(`${JSON.stringify(withoutMaina, null, 2)}\n`).toBe(CLAUDE_JSON);
	});

	test("keeps the file's own indentation", () => {
		const text = `${JSON.stringify({ theme: "x", mcpServers: {} }, null, "\t")}\n`;
		const op = mergeEntry(claudeProject, ENTRY, { text, backup: null });
		expect(op.content).toBe(
			`${JSON.stringify({ theme: "x", mcpServers: { maina: ENTRY } }, null, "\t")}\n`,
		);
	});

	test("creates a missing file holding only the entry, with no backup", () => {
		const op = mergeEntry(claudeProject, ENTRY, { text: null, backup: null });
		expect(op.action).toBe("created");
		expect(JSON.parse(op.content as string)).toEqual({
			mcpServers: { maina: ENTRY },
		});
		expect(op.backup).toBeUndefined();
	});

	test("a backup is written once: the first merge into an existing file asks for one", () => {
		const first = mergeEntry(claudeUser, ENTRY, {
			text: CLAUDE_JSON,
			backup: null,
		});
		expect(first.backup).toEqual({
			path: claudeUser.backupPath,
			content: CLAUDE_JSON,
		});
		// A later merge (e.g. the launcher moved) keeps the first backup.
		const second = mergeEntry(
			claudeUser,
			{ ...ENTRY, command: "/opt/maina" },
			{ text: first.content as string, backup: CLAUDE_JSON },
		);
		expect(second.action).toBe("updated");
		expect(second.backup).toBeUndefined();
	});

	test("re-merging the same entry is unchanged and writes nothing", () => {
		const first = mergeEntry(claudeUser, ENTRY, {
			text: CLAUDE_JSON,
			backup: null,
		});
		const again = mergeEntry(claudeUser, ENTRY, {
			text: first.content as string,
			backup: CLAUDE_JSON,
		});
		expect(again.action).toBe("unchanged");
		expect(again.content).toBeUndefined();
		expect(again.backup).toBeUndefined();
	});

	test("fails closed on malformed JSON or a wrong-typed container", () => {
		for (const text of ["{ nope", `{"mcpServers": []}`, "[1]"]) {
			const op = mergeEntry(claudeUser, ENTRY, { text, backup: null });
			expect(op.action).toBe("skipped");
			expect(op.content).toBeUndefined();
			expect(op.reason).toBeDefined();
		}
	});
});

describe("mergeEntry — JSON array containers (Continue)", () => {
	const entry = { name: "maina", transport: { type: "stdio", command: "m" } };

	test("appends by name and keeps siblings", () => {
		const text = `${JSON.stringify(
			{
				models: [{ title: "x" }],
				experimental: { modelContextProtocolServers: [{ name: "other" }] },
			},
			null,
			2,
		)}\n`;
		const op = mergeEntry(continueGlobal, entry, { text, backup: null });
		expect(op.action).toBe("updated");
		const parsed = JSON.parse(op.content as string);
		expect(parsed.models).toEqual([{ title: "x" }]);
		expect(parsed.experimental.modelContextProtocolServers).toEqual([
			{ name: "other" },
			entry,
		]);
		const again = mergeEntry(continueGlobal, entry, {
			text: op.content as string,
			backup: text,
		});
		expect(again.action).toBe("unchanged");
	});
});

describe("wrong-typed containers are reported and skipped (#384)", () => {
	// A user's config may hold the container key with the other shape: an
	// array where maina expects an object (`"mcpServers": []`), or an
	// object where it expects a list (Continue's legacy shape). maina must
	// neither clobber that value nor silently do nothing: every entry point
	// reports the mismatch and leaves the bytes alone.
	const entry = { name: "maina", transport: { type: "stdio", command: "m" } };
	const LEGACY_CONTINUE = `${JSON.stringify(
		{
			experimental: {
				modelContextProtocolServers: { other: { command: "o" } },
			},
		},
		null,
		2,
	)}\n`;
	const EXPERIMENTAL_LIST = `{"experimental": [1, 2]}\n`;
	const SERVERS_LIST = `{"mcpServers": [{"name": "mine"}]}\n`;

	const cases: ReadonlyArray<readonly [string, TargetFile, string, unknown]> = [
		["object where a list is expected", continueGlobal, LEGACY_CONTINUE, entry],
		["list on the path to a list", continueGlobal, EXPERIMENTAL_LIST, entry],
		["list where an object is expected", claudeUser, SERVERS_LIST, ENTRY],
	];

	test.each(cases)("setEntry: %s", (_label, t, text, value) => {
		const next = setEntry(t, text, value);
		expect(next.ok).toBe(false);
		if (next.ok) return;
		expect(next.reason).toMatch(/not (a list|an object)/);
	});

	test.each(cases)("deleteEntry: %s", (_label, t, text) => {
		const next = deleteEntry(t, text);
		expect(next.ok).toBe(false);
		if (next.ok) return;
		expect(next.reason).toMatch(/not (a list|an object)/);
	});

	test.each(cases)("mergeEntry skips: %s", (_label, t, text, value) => {
		const op = mergeEntry(t, value, { text, backup: null });
		expect(op.action).toBe("skipped");
		expect(op.content).toBeUndefined();
		expect(op.backup).toBeUndefined();
		expect(op.reason).toMatch(/not (a list|an object)/);
	});

	test.each(cases)("removeEntry skips: %s", (_label, t, text) => {
		const op = removeEntry(t, { text, backup: null });
		expect(op.action).toBe("skipped");
		expect(op.content).toBeUndefined();
		expect(op.reason).toMatch(/not (a list|an object)/);
	});
});

describe("mergeEntry — TOML (Codex)", () => {
	const CONFIG = [
		"# my codex config",
		'model = "o3"',
		"",
		"[mcp_servers.other]",
		'command = "other"  # keep this comment',
		'args = ["a"]',
		"",
	].join("\n");

	test("appends [mcp_servers.maina] and keeps every other byte", () => {
		const op = mergeEntry(codex, ENTRY, { text: CONFIG, backup: null });
		expect(op.action).toBe("updated");
		const out = op.content as string;
		expect(out.startsWith(CONFIG)).toBe(true);
		const parsed = toml.parse(out) as Record<string, unknown>;
		expect(parsed.model).toBe("o3");
		expect(parsed.mcp_servers).toEqual({
			other: { command: "other", args: ["a"] },
			maina: ENTRY,
		});
		expect(op.backup?.content).toBe(CONFIG);
	});

	test("replaces an existing maina table in place of appending a second one", () => {
		const first = mergeEntry(codex, ENTRY, { text: CONFIG, backup: null });
		const next = { command: "/opt/maina", args: ["--mcp"] };
		const second = mergeEntry(codex, next, {
			text: first.content as string,
			backup: CONFIG,
		});
		expect(second.action).toBe("updated");
		const out = second.content as string;
		expect(out.match(/\[mcp_servers\.maina\]/g)).toHaveLength(1);
		expect(
			(toml.parse(out) as { mcp_servers: Record<string, unknown> }).mcp_servers
				.maina,
		).toEqual(next);
		expect(out.startsWith(CONFIG)).toBe(true);
	});

	test("creates a fresh config.toml", () => {
		const op = mergeEntry(codex, ENTRY, { text: null, backup: null });
		expect(op.action).toBe("created");
		expect(toml.parse(op.content as string)).toEqual({
			mcp_servers: { maina: ENTRY },
		});
	});

	test("fails closed on invalid TOML and on a maina entry it cannot own", () => {
		const invalid = mergeEntry(codex, ENTRY, {
			text: "model = ",
			backup: null,
		});
		expect(invalid.action).toBe("skipped");
		const inline = mergeEntry(codex, ENTRY, {
			text: '[mcp_servers]\nmaina = { command = "x" }\n',
			backup: null,
		});
		expect(inline.action).toBe("skipped");
		expect(inline.content).toBeUndefined();
	});

	test("never writes TOML that would break Codex: an unsafe append is skipped", () => {
		for (const text of [
			// Inline table: a later [mcp_servers.maina] header redefines it.
			'mcp_servers = { other = { command = "x" } }\n',
			// Not a table at all.
			'model = "o3"\nmcp_servers = "oops"\n',
			// Array of tables: the header would land inside its last element.
			'[[mcp_servers]]\nname = "x"\n',
			// A header-looking line inside a multi-line string.
			'[a]\ns = """\n[mcp_servers.maina]\nfoo\n"""\n',
		]) {
			const op = mergeEntry(codex, ENTRY, { text, backup: null });
			expect(op.action).toBe("skipped");
			expect(op.content).toBeUndefined();
			expect(op.backup).toBeUndefined();
		}
	});
});
