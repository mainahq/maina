/**
 * Unit tests for the `maina mcp` action layer.
 *
 * The Commander wrapper isn't tested here (it's just option-plumbing); the
 * heavy lifting is in core's apply.test.ts. These tests assert the CLI's
 * own contract: option parsing, error surfacing, and the JSON shape.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpAction, parseClientList, parseScope } from "../mcp";

let HOME: string;

beforeEach(() => {
	HOME = join(
		tmpdir(),
		`maina-cli-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(HOME, { recursive: true });
	// Pretend Cursor is installed so auto-detection picks it up.
	mkdirSync(join(HOME, ".cursor"), { recursive: true });
});

afterEach(() => {
	rmSync(HOME, { recursive: true, force: true });
});

// ── parseClientList ────────────────────────────────────────────────────────

describe("parseClientList", () => {
	test("returns undefined when no value passed (auto-detect)", () => {
		expect(parseClientList(undefined)).toBeUndefined();
		expect(parseClientList("")).toBeUndefined();
	});

	test("splits on commas, trims, lowercases", () => {
		expect(parseClientList("Claude, Cursor, Windsurf")).toEqual([
			"claude",
			"cursor",
			"windsurf",
		]);
	});

	test("throws on unknown client with helpful list", () => {
		expect(() => parseClientList("claude,nope")).toThrow(
			/Unknown client: nope/,
		);
	});

	test("returns undefined for empty list after trimming", () => {
		expect(parseClientList(", ,")).toBeUndefined();
	});
});

describe("parseScope", () => {
	test("defaults to global when undefined", () => {
		expect(parseScope(undefined)).toBe("global");
	});
	test("accepts global / project / both case-insensitive", () => {
		expect(parseScope("GLOBAL")).toBe("global");
		expect(parseScope("project")).toBe("project");
		expect(parseScope("Both")).toBe("both");
	});
	test("throws on unknown scope", () => {
		expect(() => parseScope("user")).toThrow(/Unknown scope/);
	});
});

// ── mcpAction (end-to-end against tmp HOME) ────────────────────────────────

describe("mcpAction add", () => {
	test("auto-detects Cursor in tmp HOME and writes its global config", async () => {
		const r = await mcpAction({ command: "add", home: HOME });
		const cursor = r.report?.results.find((x) => x.clientId === "cursor");
		expect(cursor?.action).toBe("created");
		expect(cursor?.scope).toBe("global");
	});

	test("--client claude installs only claude even though it isn't detected", async () => {
		const r = await mcpAction({
			command: "add",
			home: HOME,
			client: "claude",
		});
		expect(r.report?.results).toHaveLength(1);
		expect(r.report?.results[0]?.clientId).toBe("claude");
		expect(r.report?.results[0]?.action).toBe("created");
	});

	test("dry-run skips disk writes", async () => {
		const r = await mcpAction({
			command: "add",
			home: HOME,
			dryRun: true,
			client: "cursor",
		});
		expect(r.report?.results[0]?.dryRun).toBe(true);
		expect(r.report?.results[0]?.action).toBe("created");
	});

	test("invalid --client value surfaces an error", async () => {
		const r = await mcpAction({
			command: "add",
			home: HOME,
			client: "made-up",
		});
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Unknown client/);
	});

	test("invalid --scope value surfaces an error", async () => {
		const r = await mcpAction({ command: "add", home: HOME, scope: "user" });
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Unknown scope/);
	});
});

describe("mcpAction remove", () => {
	test("removes a previously added entry", async () => {
		await mcpAction({ command: "add", home: HOME, client: "cursor" });
		const r = await mcpAction({
			command: "remove",
			home: HOME,
			client: "cursor",
		});
		expect(r.report?.results[0]?.action).toBe("removed");
	});

	test("'absent' when nothing to remove", async () => {
		const r = await mcpAction({
			command: "remove",
			home: HOME,
			client: "claude",
		});
		expect(r.report?.results[0]?.action).toBe("absent");
	});
});

describe("mcpAction list", () => {
	test("reports installed=false for fresh HOME, true after add", async () => {
		const before = await mcpAction({
			command: "list",
			home: HOME,
			client: "cursor",
		});
		expect(before.list?.entries[0]?.installed).toBe(false);
		await mcpAction({ command: "add", home: HOME, client: "cursor" });
		const after = await mcpAction({
			command: "list",
			home: HOME,
			client: "cursor",
		});
		expect(after.list?.entries[0]?.installed).toBe(true);
	});

	test("scope=both lists global and project rows for each client", async () => {
		const r = await mcpAction({
			command: "list",
			home: HOME,
			scope: "both",
			client: "cursor",
			cwd: HOME,
		});
		expect(r.list?.entries).toHaveLength(2);
		const scopes = r.list?.entries.map((e) => e.scope).sort();
		expect(scopes).toEqual(["global", "project"]);
	});
});
