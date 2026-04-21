/**
 * W2: Doctor reads global MCP registrations in addition to project-local.
 *
 * We override `$HOME` via env (not fs mocks) so production `os.homedir()` lookups
 * see our fixture config files exactly as they would a real user's home dir.
 */

import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const actual = await import("@mainahq/core");

mock.module("@mainahq/core", () => ({
	...actual,
	detectTools: async () => [],
	createCacheManager: () => ({
		stats: () => ({
			l1Hits: 0,
			l2Hits: 0,
			misses: 0,
			totalQueries: 0,
			entriesL1: 0,
			entriesL2: 0,
		}),
		get: () => null,
		set: () => {},
		has: () => false,
		invalidate: () => {},
		clear: () => {},
	}),
	getApiKey: () => null,
	isHostMode: () => false,
	getFeedbackDb: () => ({ ok: false, error: "no db" }),
}));

mock.module("@clack/prompts", () => ({
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		error: () => {},
		warning: () => {},
		success: () => {},
		message: () => {},
		step: () => {},
	},
	spinner: () => ({ start: () => {}, stop: () => {} }),
	confirm: async () => true,
}));

afterAll(() => {
	mock.restore();
});

const { doctorAction } = await import("../doctor");

function makeHome(): string {
	const d = join(
		tmpdir(),
		`maina-doctor-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(d, { recursive: true });
	return d;
}

function makeCwd(): string {
	const d = join(
		tmpdir(),
		`maina-doctor-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(d, { recursive: true });
	return d;
}

function writeGlobalClaudeMcp(home: string): void {
	const dir = join(home, ".claude");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "settings.json"),
		JSON.stringify({
			mcpServers: {
				maina: { command: "npx", args: ["@mainahq/cli", "--mcp"] },
			},
		}),
	);
}

let savedHome: string | undefined;
let home: string;
let cwd: string;

beforeEach(() => {
	savedHome = process.env.HOME;
	home = makeHome();
	cwd = makeCwd();
	process.env.HOME = home;
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
});

describe("doctor — global MCP detection", () => {
	test("reports claude as global when only ~/.claude/settings.json is wired", async () => {
		writeGlobalClaudeMcp(home);
		const result = await doctorAction({ cwd, home });
		const claude = result.mcpHealth.integrations?.find(
			(i) => i.client === "claude",
		);
		expect(claude).toBeDefined();
		expect(claude?.scope).toBe("global");
	});

	test("reports other clients as missing with fix strings", async () => {
		writeGlobalClaudeMcp(home);
		const result = await doctorAction({ cwd, home });
		const missing = result.mcpHealth.integrations?.filter(
			(i) => i.scope === "missing",
		);
		expect(missing?.length ?? 0).toBeGreaterThan(0);
		for (const row of missing ?? []) {
			expect(row.fix).toBeDefined();
			expect(row.fix ?? "").not.toBe("");
		}
	});

	test("with no global and no project config, claude is missing", async () => {
		// no writes
		const result = await doctorAction({ cwd, home });
		const claude = result.mcpHealth.integrations?.find(
			(i) => i.client === "claude",
		);
		expect(claude?.scope).toBe("missing");
		expect(claude?.fix).toMatch(/maina mcp add/);
	});

	test("project .mcp.json with maina → claude reports project scope", async () => {
		mkdirSync(cwd, { recursive: true });
		writeFileSync(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					maina: { command: "maina", args: ["--mcp"] },
				},
			}),
		);
		const result = await doctorAction({ cwd, home });
		const claude = result.mcpHealth.integrations?.find(
			(i) => i.client === "claude",
		);
		// Either project or both (project can coexist with global claude settings)
		expect(["project", "both"]).toContain(claude?.scope ?? "");
	});

	test("both project and global claude config → scope=both", async () => {
		writeGlobalClaudeMcp(home);
		mkdirSync(join(cwd, ".claude"), { recursive: true });
		writeFileSync(
			join(cwd, ".claude", "settings.json"),
			JSON.stringify({
				mcpServers: {
					maina: { command: "maina", args: ["--mcp"] },
				},
			}),
		);
		const result = await doctorAction({ cwd, home });
		const claude = result.mcpHealth.integrations?.find(
			(i) => i.client === "claude",
		);
		expect(claude?.scope).toBe("both");
	});
});
