/**
 * `applyOps` — the effectful half of the single onboarding flow (#288).
 *
 * Every read and write goes through the injected `OnboardingFs` port, so
 * these tests run against an in-memory map. `applyOps` re-reads each file
 * at apply time and fails closed: anything it cannot merge safely is
 * reported as skipped and left untouched.
 */

import { describe, expect, test } from "bun:test";
import type { Result } from "@mainahq/core";
import {
	applyOps,
	BACKUP_DIR,
	type OnboardingFs,
	snapshotFiles,
} from "../apply";
import type { FileOp } from "../plan";
import {
	MAINA_REGION_END,
	MAINA_REGION_START,
} from "../setup/agent-files/region";

function memoryFs(
	initial: Record<string, string> = {},
	failWrites: ReadonlySet<string> = new Set(),
): { fs: OnboardingFs; files: Map<string, string> } {
	const files = new Map(Object.entries(initial));
	const fs: OnboardingFs = {
		read: (path): Result<string | null> => ({
			ok: true,
			value: files.get(path) ?? null,
		}),
		write: (path, content): Result<void> => {
			if (failWrites.has(path)) return { ok: false, error: "EACCES" };
			files.set(path, content);
			return { ok: true, value: undefined };
		},
		create: (path, content): Result<"created" | "exists"> => {
			if (failWrites.has(path)) return { ok: false, error: "EACCES" };
			if (files.has(path)) return { ok: true, value: "exists" };
			files.set(path, content);
			return { ok: true, value: "created" };
		},
	};
	return { fs, files };
}

const ENTRY = { command: "bunx", args: ["@mainahq/cli", "--mcp"] };

function mergeKey(path: string, backup = false): FileOp {
	return {
		kind: "merge-json-key",
		path,
		keyPath: ["mcpServers", "maina"],
		content: JSON.stringify(ENTRY),
		backup,
	};
}

describe("applyOps — writes through the port", () => {
	test("create, merge-region and merge-json-key land where planned", () => {
		const { fs, files } = memoryFs({
			"CLAUDE.md": "user notes\n",
			".mcp.json": '{\n  "mcpServers": {}\n}\n',
		});
		const result = applyOps(
			[
				{ kind: "create", path: ".maina/x.md", content: "x\n", backup: false },
				{
					kind: "merge-region",
					path: "CLAUDE.md",
					content: "maina body",
					backup: false,
				},
				mergeKey(".mcp.json"),
			],
			{ fs },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.created).toEqual([".maina/x.md"]);
		expect(result.value.merged).toEqual(["CLAUDE.md", ".mcp.json"]);
		expect(files.get(".maina/x.md")).toBe("x\n");
		expect(files.get("CLAUDE.md")).toBe(
			`user notes\n\n${MAINA_REGION_START}\nmaina body\n${MAINA_REGION_END}\n`,
		);
		expect(JSON.parse(files.get(".mcp.json") ?? "")).toEqual({
			mcpServers: { maina: ENTRY },
		});
	});

	test("merge ops against a missing file create it", () => {
		const { fs, files } = memoryFs();
		const result = applyOps(
			[
				{ kind: "merge-region", path: "AGENTS.md", content: "b", backup: true },
				mergeKey(".cursor/mcp.json", true),
			],
			{ fs },
		);
		expect(result.ok && result.value.created).toEqual([
			"AGENTS.md",
			".cursor/mcp.json",
		]);
		expect(files.get("AGENTS.md")).toBe(
			`${MAINA_REGION_START}\nb\n${MAINA_REGION_END}\n`,
		);
		// Nothing existed, so nothing was backed up.
		expect([...files.keys()].some((p) => p.startsWith(BACKUP_DIR))).toBe(false);
	});

	test("an op whose result equals the current bytes is reported unchanged", () => {
		const current = `${MAINA_REGION_START}\nsame\n${MAINA_REGION_END}\n`;
		const { fs } = memoryFs({ "AGENTS.md": current });
		const result = applyOps(
			[
				{
					kind: "merge-region",
					path: "AGENTS.md",
					content: "same",
					backup: false,
				},
			],
			{ fs },
		);
		expect(result.ok && result.value.unchanged).toEqual(["AGENTS.md"]);
	});
});

describe("applyOps — never overwrites", () => {
	test("create against a file that appeared after planning is skipped", () => {
		const { fs, files } = memoryFs({ ".maina/constitution.md": "mine\n" });
		const result = applyOps(
			[
				{
					kind: "create",
					path: ".maina/constitution.md",
					content: "generated\n",
					backup: false,
				},
			],
			{ fs },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.created).toEqual([]);
		expect(result.value.skipped.map((s) => s.path)).toEqual([
			".maina/constitution.md",
		]);
		expect(files.get(".maina/constitution.md")).toBe("mine\n");
	});

	test("a file created between the read and the write is not replaced", () => {
		// Another process creates the file after applyOps has read it as
		// missing: the create must not clobber it.
		const { fs, files } = memoryFs({ "AGENTS.md": "theirs\n" });
		const racing: OnboardingFs = {
			...fs,
			read: (path) =>
				path === "AGENTS.md" ? { ok: true, value: null } : fs.read(path),
		};
		for (const op of [
			{ kind: "create", path: "AGENTS.md", content: "ours", backup: false },
			{
				kind: "merge-region",
				path: "AGENTS.md",
				content: "ours",
				backup: false,
			},
		] as const) {
			const result = applyOps([op], { fs: racing });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.created).toEqual([]);
			expect(result.value.skipped.map((s) => s.path)).toEqual(["AGENTS.md"]);
			expect(files.get("AGENTS.md")).toBe("theirs\n");
		}
	});

	test("malformed JSON is skipped and left byte-identical (fail closed)", () => {
		const broken = '{ "mcpServers": { "memory": ';
		const { fs, files } = memoryFs({ ".claude/settings.json": broken });
		const result = applyOps([mergeKey(".claude/settings.json", true)], { fs });
		expect(result.ok && result.value.skipped.length).toBe(1);
		expect(files.get(".claude/settings.json")).toBe(broken);
	});

	test("a container of the wrong type is never clobbered (#384)", () => {
		for (const text of [
			'{ "mcpServers": [] }\n',
			'{ "mcpServers": "nope" }\n',
			"[1, 2]\n",
		]) {
			const { fs, files } = memoryFs({ ".mcp.json": text });
			const result = applyOps([mergeKey(".mcp.json", true)], { fs });
			expect(result.ok && result.value.skipped.length).toBe(1);
			expect(files.get(".mcp.json")).toBe(text);
		}
	});
});

describe("applyOps — backups", () => {
	test("backs up the original before the first merge, once", () => {
		const original = "# mine\n";
		const { fs, files } = memoryFs({ "CLAUDE.md": original });
		const op: FileOp = {
			kind: "merge-region",
			path: "CLAUDE.md",
			content: "v1",
			backup: true,
		};
		const first = applyOps([op], { fs });
		expect(first.ok && first.value.backups).toEqual([
			`${BACKUP_DIR}/CLAUDE.md`,
		]);
		expect(files.get(`${BACKUP_DIR}/CLAUDE.md`)).toBe(original);
		// Copies of user files stay out of commits.
		expect(files.get(`${BACKUP_DIR}/.gitignore`)).toBe("*\n");

		// A later run that still asks for a backup must not replace the
		// pristine copy with an already-merged file.
		applyOps([{ ...op, content: "v2" }], { fs });
		expect(files.get(`${BACKUP_DIR}/CLAUDE.md`)).toBe(original);
	});

	test("if the backup cannot be written, the file is not modified", () => {
		const { fs, files } = memoryFs(
			{ "CLAUDE.md": "# mine\n" },
			new Set([`${BACKUP_DIR}/CLAUDE.md`]),
		);
		const result = applyOps(
			[{ kind: "merge-region", path: "CLAUDE.md", content: "x", backup: true }],
			{ fs },
		);
		expect(result.ok && result.value.skipped.length).toBe(1);
		expect(files.get("CLAUDE.md")).toBe("# mine\n");
	});
});

describe("applyOps — errors", () => {
	test("paths escaping the repo are rejected before anything is written", () => {
		for (const path of ["../outside.md", "/etc/passwd", "a/../../b"]) {
			const { fs, files } = memoryFs();
			const result = applyOps(
				[
					{ kind: "create", path: "ok.md", content: "x", backup: false },
					{ kind: "create", path, content: "x", backup: false },
				],
				{ fs },
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error).toEqual({ kind: "unsafe-path", path });
			expect(files.size).toBe(0);
		}
	});

	test("a failed write is reported and the remaining ops still apply", () => {
		const { fs, files } = memoryFs({}, new Set(["AGENTS.md"]));
		const result = applyOps(
			[
				{ kind: "create", path: "AGENTS.md", content: "a", backup: false },
				{ kind: "create", path: "CLAUDE.md", content: "c", backup: false },
			],
			{ fs },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.skipped.map((s) => s.path)).toEqual(["AGENTS.md"]);
		expect(result.value.created).toEqual(["CLAUDE.md"]);
		expect(files.has("AGENTS.md")).toBe(false);
	});
});

describe("snapshotFiles", () => {
	test("returns the current bytes of the files that exist", () => {
		const { fs } = memoryFs({ "a.md": "A", "b.md": "" });
		const snap = snapshotFiles(fs, ["a.md", "b.md", "missing.md"]);
		expect(snap).toEqual(
			new Map([
				["a.md", "A"],
				["b.md", ""],
			]),
		);
	});
});
