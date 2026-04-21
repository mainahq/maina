/**
 * W2: Every `missing` MCP integration row includes a shell-parseable `fix`.
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
import { mkdirSync, rmSync } from "node:fs";
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

let savedHome: string | undefined;
let home: string;
let cwd: string;

beforeEach(() => {
	savedHome = process.env.HOME;
	home = join(
		tmpdir(),
		`maina-doctor-fix-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	cwd = join(
		tmpdir(),
		`maina-doctor-fix-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(home, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	process.env.HOME = home;
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
});

describe("doctor — fix commands", () => {
	test("every missing row has a shell-parseable fix", async () => {
		const result = await doctorAction({ cwd, home });
		const missing = result.mcpHealth.integrations?.filter(
			(i) => i.scope === "missing",
		);
		expect(missing?.length ?? 0).toBeGreaterThan(0);
		// Shell-parseable: starts with maina | claude | cursor | npx | bunx
		const shellHead = /^(maina|claude|cursor|npx|bunx)\s+\S+/;
		for (const row of missing ?? []) {
			expect(row.fix).toBeDefined();
			expect(row.fix ?? "").toMatch(shellHead);
		}
	});
});
