/**
 * Tests for `.claude/settings.json` keyed JSON merge.
 *
 * The old behaviour was to overwrite with a `.bak` fallback — users with
 * other MCPs lost entries on every run. The new behaviour parses the
 * existing file, sets `mcpServers.maina`, and writes back — preserving
 * every non-Maina key.
 *
 * Property test: 50+ random pre-existing configs, all must retain their
 * non-Maina MCP entries byte-for-byte (modulo the JSON formatter).
 */

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeClaudeSettings } from "../claude";

const MAINA_ENTRY = {
	command: "bunx",
	args: ["@mainahq/cli", "--mcp"],
};

function tmpRepo(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `maina-${prefix}-`));
}

function writeSettings(cwd: string, value: Record<string, unknown>): string {
	const dir = join(cwd, ".claude");
	mkdirSync(dir, { recursive: true });
	const p = join(dir, "settings.json");
	writeFileSync(p, JSON.stringify(value, null, 2), "utf-8");
	return p;
}

function readSettings(cwd: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(join(cwd, ".claude", "settings.json"), "utf-8"),
	) as Record<string, unknown>;
}

describe("writeClaudeSettings", () => {
	test("creates .claude/settings.json when missing", async () => {
		const cwd = tmpRepo("claude-create");
		try {
			const res = await writeClaudeSettings(cwd, {
				mainaMcpEntry: MAINA_ENTRY,
			});
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.action).toBe("created");
			expect(existsSync(res.value.path)).toBe(true);

			const parsed = readSettings(cwd) as {
				mcpServers?: Record<string, unknown>;
			};
			expect(parsed.mcpServers).toBeDefined();
			expect(parsed.mcpServers?.maina).toEqual(MAINA_ENTRY);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("keyed merge preserves unrelated mcpServers entries", async () => {
		const cwd = tmpRepo("claude-merge");
		try {
			writeSettings(cwd, {
				mcpServers: {
					filesystem: {
						command: "node",
						args: ["/tmp/fs-server.js"],
					},
					github: {
						command: "bunx",
						args: ["@modelcontextprotocol/server-github"],
					},
				},
			});

			const res = await writeClaudeSettings(cwd, {
				mainaMcpEntry: MAINA_ENTRY,
			});
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.action).toBe("merged");

			const parsed = readSettings(cwd) as {
				mcpServers: Record<string, { command: string; args: string[] }>;
			};
			expect(parsed.mcpServers.maina).toEqual(MAINA_ENTRY);
			expect(parsed.mcpServers.filesystem).toEqual({
				command: "node",
				args: ["/tmp/fs-server.js"],
			});
			expect(parsed.mcpServers.github).toEqual({
				command: "bunx",
				args: ["@modelcontextprotocol/server-github"],
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("preserves unrelated top-level keys", async () => {
		const cwd = tmpRepo("claude-toplevel");
		try {
			writeSettings(cwd, {
				theme: "dark",
				editor: { fontSize: 14, wordWrap: true },
				mcpServers: {
					postgres: { command: "bunx", args: ["pg-server"] },
				},
			});

			const res = await writeClaudeSettings(cwd, {
				mainaMcpEntry: MAINA_ENTRY,
			});
			expect(res.ok).toBe(true);

			const parsed = readSettings(cwd) as {
				theme?: string;
				editor?: { fontSize?: number; wordWrap?: boolean };
				mcpServers: Record<string, unknown>;
			};
			expect(parsed.theme).toBe("dark");
			expect(parsed.editor?.fontSize).toBe(14);
			expect(parsed.editor?.wordWrap).toBe(true);
			expect(parsed.mcpServers.postgres).toEqual({
				command: "bunx",
				args: ["pg-server"],
			});
			expect(parsed.mcpServers.maina).toEqual(MAINA_ENTRY);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("idempotent: re-run produces byte-identical file", async () => {
		const cwd = tmpRepo("claude-idempotent");
		try {
			writeSettings(cwd, {
				mcpServers: {
					foo: { command: "x", args: ["--y"] },
				},
			});
			const first = await writeClaudeSettings(cwd, {
				mainaMcpEntry: MAINA_ENTRY,
			});
			expect(first.ok).toBe(true);
			const before = readFileSync(
				join(cwd, ".claude", "settings.json"),
				"utf-8",
			);
			const second = await writeClaudeSettings(cwd, {
				mainaMcpEntry: MAINA_ENTRY,
			});
			expect(second.ok).toBe(true);
			const after = readFileSync(
				join(cwd, ".claude", "settings.json"),
				"utf-8",
			);
			expect(after).toBe(before);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("no mcpServers key → added without touching rest", async () => {
		const cwd = tmpRepo("claude-nomcp");
		try {
			writeSettings(cwd, { theme: "light" });
			const res = await writeClaudeSettings(cwd, {
				mainaMcpEntry: MAINA_ENTRY,
			});
			expect(res.ok).toBe(true);

			const parsed = readSettings(cwd) as {
				theme?: string;
				mcpServers?: Record<string, unknown>;
			};
			expect(parsed.theme).toBe("light");
			expect(parsed.mcpServers?.maina).toEqual(MAINA_ENTRY);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("unparseable JSON is preserved as .bak.<ts> and file rewritten", async () => {
		const cwd = tmpRepo("claude-malformed");
		try {
			const dir = join(cwd, ".claude");
			mkdirSync(dir, { recursive: true });
			const p = join(dir, "settings.json");
			writeFileSync(p, "{ this is not json", "utf-8");

			const res = await writeClaudeSettings(cwd, {
				mainaMcpEntry: MAINA_ENTRY,
			});
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.action).toBe("recovered");

			// Fresh file is now valid JSON with maina entry.
			const parsed = readSettings(cwd) as {
				mcpServers: Record<string, unknown>;
			};
			expect(parsed.mcpServers.maina).toEqual(MAINA_ENTRY);

			// Old content saved somewhere with .bak.
			const { readdirSync } = await import("node:fs");
			const files = readdirSync(dir);
			expect(files.some((f) => f.startsWith("settings.json.bak."))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

// ── Property test: 50 random configs ────────────────────────────────────────
//
// Seeded RNG so reruns are deterministic.

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomAscii(rng: () => number, minLen = 3, maxLen = 12): string {
	const n = Math.floor(rng() * (maxLen - minLen + 1)) + minLen;
	const alphabet = "abcdefghijklmnopqrstuvwxyz_-";
	let out = "";
	for (let i = 0; i < n; i++) {
		out += alphabet[Math.floor(rng() * alphabet.length)];
	}
	return out;
}

function randomMcpEntry(rng: () => number): {
	command: string;
	args: string[];
} {
	const nArgs = Math.floor(rng() * 4);
	const args: string[] = [];
	for (let i = 0; i < nArgs; i++) args.push(randomAscii(rng));
	return {
		command: randomAscii(rng, 2, 6),
		args,
	};
}

describe("writeClaudeSettings — property test (50+ random configs)", () => {
	test("preserves every non-maina mcpServers entry across runs", async () => {
		const rng = mulberry32(0xc0ffee);

		for (let iter = 0; iter < 52; iter++) {
			const cwd = tmpRepo(`claude-prop-${iter}`);
			try {
				const existing: Record<string, { command: string; args: string[] }> =
					{};
				const nEntries = Math.floor(rng() * 5) + 1; // 1..5
				const names = new Set<string>();
				for (let i = 0; i < nEntries; i++) {
					let name = randomAscii(rng);
					// Avoid accidental collision with "maina" so assertions work.
					if (name === "maina") name = `${name}1`;
					if (names.has(name)) continue;
					names.add(name);
					existing[name] = randomMcpEntry(rng);
				}

				// Sometimes include an unrelated top-level key.
				const payload: Record<string, unknown> = { mcpServers: existing };
				if (rng() < 0.5) {
					payload.theme = rng() < 0.5 ? "dark" : "light";
				}
				if (rng() < 0.3) {
					payload.misc = { foo: "bar", n: Math.floor(rng() * 100) };
				}

				writeSettings(cwd, payload);

				const res = await writeClaudeSettings(cwd, {
					mainaMcpEntry: MAINA_ENTRY,
				});
				expect(res.ok).toBe(true);

				const parsed = readSettings(cwd) as {
					mcpServers: Record<string, unknown>;
					theme?: string;
					misc?: { foo?: string; n?: number };
				};

				// All existing entries preserved, maina added.
				for (const [name, entry] of Object.entries(existing)) {
					expect(parsed.mcpServers[name]).toEqual(entry);
				}
				expect(parsed.mcpServers.maina).toEqual(MAINA_ENTRY);

				// Top-level keys untouched.
				if (typeof payload.theme === "string") {
					expect(parsed.theme).toBe(payload.theme);
				}
				if (payload.misc !== undefined) {
					expect(parsed.misc).toEqual(
						payload.misc as { foo?: string; n?: number },
					);
				}
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		}
	});
});
