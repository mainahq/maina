import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContextDb } from "../../db/index.ts";
import { buildIssueBody, createTicket, detectModules } from "../index.ts";

const TEST_DIR = join(tmpdir(), `maina-ticket-test-${Date.now()}`);

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── detectModules ───────────────────────────────────────────────────────────

describe("detectModules", () => {
	test("returns empty array when DB does not exist", async () => {
		const nonExistent = join(TEST_DIR, "no-such-dir");
		const result = detectModules(nonExistent, "some title", "some body");
		expect(result).toEqual([]);
	});

	test("returns empty array when no entities match keywords", () => {
		const mainaDir = join(TEST_DIR, "no-match");
		mkdirSync(mainaDir, { recursive: true });

		// Create DB with entities that don't match
		const dbResult = getContextDb(mainaDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		// Insert a semantic entity in the "auth" module
		db.exec(`
			INSERT INTO semantic_entities (id, file_path, name, kind, start_line, end_line, updated_at)
			VALUES ('e1', 'src/auth/login.ts', 'login', 'function', 1, 10, '2026-01-01')
		`);

		const modules = detectModules(
			mainaDir,
			"fix database query",
			"slow query in cache layer",
		);
		// "auth" should not match "database query" or "cache layer"
		// but "cache" is not in the DB, so result should be empty
		expect(modules).toEqual([]);
		db.close();
	});

	test("returns matching module names from semantic entities", () => {
		const mainaDir = join(TEST_DIR, "match-modules");
		mkdirSync(mainaDir, { recursive: true });

		const dbResult = getContextDb(mainaDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		// Insert entities in different modules
		db.exec(`
			INSERT INTO semantic_entities (id, file_path, name, kind, start_line, end_line, updated_at)
			VALUES
				('e1', 'src/context/engine.ts', 'assembleContext', 'function', 1, 50, '2026-01-01'),
				('e2', 'src/verify/pipeline.ts', 'runPipeline', 'function', 1, 30, '2026-01-01'),
				('e3', 'src/verify/slop.ts', 'detectSlop', 'function', 1, 20, '2026-01-01'),
				('e4', 'src/cli/commands/commit.ts', 'commitAction', 'function', 1, 40, '2026-01-01')
		`);

		const modules = detectModules(
			mainaDir,
			"Fix context engine budget",
			"The context assembly is exceeding token budget",
		);

		expect(modules).toContain("context");
		expect(modules).not.toContain("cli");
		db.close();
	});

	test("deduplicates module names", () => {
		const mainaDir = join(TEST_DIR, "dedup-modules");
		mkdirSync(mainaDir, { recursive: true });

		const dbResult = getContextDb(mainaDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		// Multiple entities in the same module
		db.exec(`
			INSERT INTO semantic_entities (id, file_path, name, kind, start_line, end_line, updated_at)
			VALUES
				('e1', 'src/verify/pipeline.ts', 'runPipeline', 'function', 1, 30, '2026-01-01'),
				('e2', 'src/verify/slop.ts', 'detectSlop', 'function', 1, 20, '2026-01-01'),
				('e3', 'src/verify/diff-filter.ts', 'filterByDiff', 'function', 1, 15, '2026-01-01')
		`);

		const modules = detectModules(
			mainaDir,
			"Fix verify pipeline",
			"The verify slop detector has a bug in diff filter",
		);

		// Should have "verify" only once
		const verifyCount = modules.filter((m) => m === "verify").length;
		expect(verifyCount).toBeLessThanOrEqual(1);
		expect(modules).toContain("verify");
		db.close();
	});
});

// ── buildIssueBody ──────────────────────────────────────────────────────────

describe("buildIssueBody", () => {
	test("appends Modules section when modules are found", () => {
		const body = "Fix the context engine budget calculation.";
		const modules = ["context", "verify", "cli"];

		const result = buildIssueBody(body, modules);

		expect(result).toContain(body);
		expect(result).toContain("**Modules:** context, verify, cli");
	});

	test("returns body unchanged when no modules", () => {
		const body = "Fix the context engine budget calculation.";

		const result = buildIssueBody(body, []);

		expect(result).toBe(body);
	});

	test("handles empty body with modules", () => {
		const result = buildIssueBody("", ["core"]);

		expect(result).toContain("**Modules:** core");
	});
});

// ── createTicket ────────────────────────────────────────────────────────────

describe("createTicket", () => {
	test("returns success with url and number on successful gh call", async () => {
		const mockSpawn = async (_args: string[], _opts?: { cwd?: string }) => ({
			exitCode: 0,
			stdout: "https://github.com/owner/repo/issues/42\n",
			stderr: "",
		});

		const result = await createTicket(
			{
				title: "Test issue",
				body: "Test body",
				labels: ["bug"],
			},
			{ spawn: mockSpawn },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.url).toBe("https://github.com/owner/repo/issues/42");
		expect(result.value.number).toBe(42);
	});

	test("passes labels to gh issue create", async () => {
		let capturedArgs: string[] = [];
		const mockSpawn = async (args: string[], _opts?: { cwd?: string }) => {
			capturedArgs = args;
			return {
				exitCode: 0,
				stdout: "https://github.com/owner/repo/issues/1\n",
				stderr: "",
			};
		};

		await createTicket(
			{
				title: "Test",
				body: "Body",
				labels: ["bug", "context"],
			},
			{ spawn: mockSpawn },
		);

		expect(capturedArgs).toContain("--label");
		expect(capturedArgs).toContain("bug,context");
	});

	test("returns error when gh fails", async () => {
		const mockSpawn = async (_args: string[], _opts?: { cwd?: string }) => ({
			exitCode: 1,
			stdout: "",
			stderr: "gh: not logged in",
		});

		const result = await createTicket(
			{
				title: "Test",
				body: "Body",
			},
			{ spawn: mockSpawn },
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("gh: not logged in");
	});

	test("returns error when gh is not installed (spawn throws)", async () => {
		const mockSpawn = async (_args: string[], _opts?: { cwd?: string }) => {
			throw new Error("spawn: command not found: gh");
		};

		const result = await createTicket(
			{
				title: "Test",
				body: "Body",
			},
			{ spawn: mockSpawn },
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("gh");
	});

	test("extracts issue number from URL", async () => {
		const mockSpawn = async (_args: string[], _opts?: { cwd?: string }) => ({
			exitCode: 0,
			stdout: "https://github.com/bikash/maina/issues/123\n",
			stderr: "",
		});

		const result = await createTicket(
			{
				title: "Test",
				body: "Body",
			},
			{ spawn: mockSpawn },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.number).toBe(123);
	});

	test("passes cwd to spawn", async () => {
		let capturedOpts: { cwd?: string } | undefined;
		const mockSpawn = async (_args: string[], opts?: { cwd?: string }) => {
			capturedOpts = opts;
			return {
				exitCode: 0,
				stdout: "https://github.com/owner/repo/issues/1\n",
				stderr: "",
			};
		};

		await createTicket(
			{
				title: "Test",
				body: "Body",
				cwd: "/some/path",
			},
			{ spawn: mockSpawn },
		);

		expect(capturedOpts?.cwd).toBe("/some/path");
	});
});
