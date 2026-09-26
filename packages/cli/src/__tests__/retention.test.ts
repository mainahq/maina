/**
 * The CLI edge that records retention events into `~/.maina/retention.jsonl`
 * (FR-RET-7): local only, and it never rejects, so no surface is held up or
 * broken by it.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FsPort } from "@mainahq/core";
import { recordRetention, retentionRecorder } from "../retention";

const HOME = "/home/dev";
const LOG = `${HOME}/.maina/retention.jsonl`;

function memoryFs(): FsPort & { files: Map<string, string> } {
	const files = new Map<string, string>();
	return {
		files,
		readFile: async (path) => {
			const content = files.get(path);
			return content === undefined
				? { ok: false, error: { kind: "not_found", path } }
				: { ok: true, value: content };
		},
		writeFile: async (path, content) => {
			files.set(path, content);
			return { ok: true, value: undefined };
		},
		exists: async (path) => files.has(path),
		readDir: async () => ({ ok: true, value: [] }),
		remove: async () => ({ ok: true, value: undefined }),
	};
}

describe("retentionRecorder", () => {
	test("appends the event to the user's retention log", async () => {
		const fs = memoryFs();
		await retentionRecorder(
			fs,
			HOME,
		)({ kind: "surface", ts: 1, surface: "digest" });
		expect(fs.files.get(LOG)).toBe(
			'{"kind":"surface","ts":1,"surface":"digest"}\n',
		);
	});

	test("without a home directory it records nothing", async () => {
		const fs = memoryFs();
		await retentionRecorder(fs, undefined)({ kind: "session", ts: 1 });
		expect(fs.files.size).toBe(0);
	});

	test("the real recorder replaces the log whole, leaving no temp file", async () => {
		const home = mkdtempSync(join(tmpdir(), "maina-retention-"));
		const saved = process.env.HOME;
		process.env.HOME = home;
		try {
			await recordRetention({ kind: "session", ts: 1 });
			await recordRetention({ kind: "surface", ts: 2, surface: "digest" });
			const dir = join(home, ".maina");
			expect(readdirSync(dir)).toEqual(["retention.jsonl"]);
			expect(readFileSync(join(dir, "retention.jsonl"), "utf-8")).toBe(
				'{"kind":"session","ts":1}\n{"kind":"surface","ts":2,"surface":"digest"}\n',
			);
		} finally {
			process.env.HOME = saved;
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("recorders running at once lose no event (a hook and the status line at session start)", async () => {
		const home = mkdtempSync(join(tmpdir(), "maina-retention-"));
		const saved = process.env.HOME;
		process.env.HOME = home;
		try {
			const events = Array.from({ length: 12 }, (_, i) => ({
				kind: "session" as const,
				ts: (i + 1) * 3_600_000,
			}));
			await Promise.all(events.map((event) => recordRetention(event)));
			const dir = join(home, ".maina");
			const lines = readFileSync(join(dir, "retention.jsonl"), "utf-8")
				.split("\n")
				.filter((line) => line !== "");
			expect(lines.length).toBe(events.length);
			expect(readdirSync(dir)).toEqual(["retention.jsonl"]);
		} finally {
			process.env.HOME = saved;
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("a failing filesystem never rejects", async () => {
		const broken: FsPort = {
			...memoryFs(),
			readFile: () => Promise.reject(new Error("EACCES")),
		};
		await expect(
			retentionRecorder(broken, HOME)({ kind: "session", ts: 1 }),
		).resolves.toBeUndefined();
	});
});
