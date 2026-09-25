/**
 * Tests for `.cursor/mcp.json` keyed JSON merge — same invariants as the
 * Claude settings merge but targeting Cursor's config shape.
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
import { writeCursorMcp } from "../cursor";

const MAINA_ENTRY = {
	command: "bunx",
	args: ["@mainahq/cli", "--mcp"],
};

function tmpRepo(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `maina-${prefix}-`));
}

function writeMcp(cwd: string, value: Record<string, unknown>): string {
	const dir = join(cwd, ".cursor");
	mkdirSync(dir, { recursive: true });
	const p = join(dir, "mcp.json");
	writeFileSync(p, JSON.stringify(value, null, 2), "utf-8");
	return p;
}

function readMcp(cwd: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(join(cwd, ".cursor", "mcp.json"), "utf-8"),
	) as Record<string, unknown>;
}

describe("writeCursorMcp", () => {
	test("creates .cursor/mcp.json when missing", async () => {
		const cwd = tmpRepo("cursor-create");
		try {
			const res = await writeCursorMcp(cwd, { mainaMcpEntry: MAINA_ENTRY });
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.action).toBe("created");
			expect(existsSync(res.value.path)).toBe(true);

			const parsed = readMcp(cwd) as {
				mcpServers: Record<string, unknown>;
			};
			expect(parsed.mcpServers.maina).toEqual(MAINA_ENTRY);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("keyed merge preserves other cursor MCP entries", async () => {
		const cwd = tmpRepo("cursor-merge");
		try {
			writeMcp(cwd, {
				mcpServers: {
					existing: { command: "node", args: ["/tmp/x.js"] },
					other: { command: "bunx", args: ["other"] },
				},
			});

			const res = await writeCursorMcp(cwd, { mainaMcpEntry: MAINA_ENTRY });
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.action).toBe("merged");

			const parsed = readMcp(cwd) as {
				mcpServers: Record<string, { command: string; args: string[] }>;
			};
			expect(parsed.mcpServers.existing).toEqual({
				command: "node",
				args: ["/tmp/x.js"],
			});
			expect(parsed.mcpServers.other).toEqual({
				command: "bunx",
				args: ["other"],
			});
			expect(parsed.mcpServers.maina).toEqual(MAINA_ENTRY);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("idempotent: second call produces the same file", async () => {
		const cwd = tmpRepo("cursor-idempotent");
		try {
			writeMcp(cwd, {
				mcpServers: { foo: { command: "y", args: [] } },
			});
			await writeCursorMcp(cwd, { mainaMcpEntry: MAINA_ENTRY });
			const before = readFileSync(join(cwd, ".cursor", "mcp.json"), "utf-8");
			await writeCursorMcp(cwd, { mainaMcpEntry: MAINA_ENTRY });
			const after = readFileSync(join(cwd, ".cursor", "mcp.json"), "utf-8");
			expect(after).toBe(before);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
