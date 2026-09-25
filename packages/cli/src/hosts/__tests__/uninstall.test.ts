/**
 * `uninstall` (FR-INS-4): removing maina restores the pre-maina state
 * exactly — the same bytes when nothing else changed, the file gone when
 * maina created it, and the user's own later edits kept otherwise.
 */

import { describe, expect, test } from "bun:test";
import { mergeEntry } from "../merge";
import { type TargetFile, targetsFor } from "../targets";
import { removeEntry, uninstall } from "../uninstall";

const ctx = { home: "/h", cwd: "/p", platform: "linux" as const };
const ENTRY = { command: "/usr/local/bin/maina", args: ["--mcp"] };

function only(host: "claude" | "codex", scope: "global" | "project") {
	return targetsFor(host, scope, ctx)[0] as TargetFile;
}

/** Install then uninstall in memory; returns the bytes left behind. */
function roundTrip(t: TargetFile, before: string | null): string | null {
	const add = mergeEntry(t, ENTRY, { text: before, backup: null });
	const installed = add.content === undefined ? before : add.content;
	const backup = add.backup?.content ?? null;
	const remove = removeEntry(t, { text: installed, backup });
	if (remove.content === undefined) return installed;
	return remove.content;
}

describe("uninstall restores the pre-maina state exactly", () => {
	test("JSON with hooks, permissions and unusual formatting comes back byte-for-byte", () => {
		const before =
			'{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"x"}]}]},\n' +
			' "permissions" : {"allow":["Bash(ls:*)"]},  "mcpServers":{"memory":{"command":"mem"}}}';
		expect(roundTrip(only("claude", "global"), before)).toBe(before);
	});

	test("TOML with comments comes back byte-for-byte", () => {
		const before =
			'# codex\nmodel = "o3"\n\n[mcp_servers.other] # mine\ncommand = "o"\n';
		expect(roundTrip(only("codex", "global"), before)).toBe(before);
		// …and without a trailing newline too.
		const bare = 'model = "o3"';
		expect(roundTrip(only("codex", "global"), bare)).toBe(bare);
	});

	test("a file maina created is deleted again", () => {
		const t = only("claude", "project");
		const add = mergeEntry(t, ENTRY, { text: null, backup: null });
		const remove = removeEntry(t, {
			text: add.content as string,
			backup: null,
		});
		expect(remove.action).toBe("removed");
		expect(remove.content).toBeNull();
		const codexT = only("codex", "global");
		const addToml = mergeEntry(codexT, ENTRY, { text: null, backup: null });
		expect(
			removeEntry(codexT, { text: addToml.content as string, backup: null })
				.content,
		).toBeNull();
	});

	test("the backup is restored and then dropped", () => {
		const t = only("claude", "global");
		const before = `${JSON.stringify({ a: 1 }, null, 2)}\n`;
		const add = mergeEntry(t, ENTRY, { text: before, backup: null });
		const remove = removeEntry(t, {
			text: add.content as string,
			backup: before,
		});
		expect(remove.action).toBe("restored");
		expect(remove.content).toBe(before);
		expect(remove.dropBackup).toBe(t.backupPath);
	});

	test("edits made after install are kept; only maina's entry goes", () => {
		const t = only("claude", "global");
		const before = `${JSON.stringify({ a: 1, mcpServers: {} }, null, 2)}\n`;
		const add = mergeEntry(t, ENTRY, { text: before, backup: null });
		const edited = JSON.parse(add.content as string);
		edited.b = 2;
		edited.mcpServers.other = { command: "o" };
		const remove = removeEntry(t, {
			text: `${JSON.stringify(edited, null, 2)}\n`,
			backup: before,
		});
		expect(remove.action).toBe("removed");
		expect(JSON.parse(remove.content as string)).toEqual({
			a: 1,
			b: 2,
			mcpServers: { other: { command: "o" } },
		});
		// The stale backup is dropped so the next install takes a fresh one.
		expect(remove.dropBackup).toBe(t.backupPath);
	});

	test("nothing to do when the file or the entry is absent", () => {
		const t = only("claude", "global");
		expect(removeEntry(t, { text: null, backup: null }).action).toBe("absent");
		const op = removeEntry(t, { text: '{"a":1}', backup: null });
		expect(op.action).toBe("absent");
		expect(op.content).toBeUndefined();
	});

	test("uninstall(host, scope) plans one op per target the host reads", () => {
		const reads: string[] = [];
		const ops = uninstall("claude", "both", ctx, (t) => {
			reads.push(t.path);
			return { text: null, backup: null };
		});
		expect(ops.map((o) => o.path)).toEqual(reads);
		expect(reads).toEqual(targetsFor("claude", "both", ctx).map((t) => t.path));
		expect(ops.every((o) => o.action === "absent")).toBe(true);
	});
});
