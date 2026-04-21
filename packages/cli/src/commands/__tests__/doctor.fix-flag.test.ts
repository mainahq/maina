/**
 * W2: `doctor --fix --yes` executes each missing row's fix command via the
 * injected `execFn`. Interactive confirmation is bypassed by --yes.
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
		`maina-doctor-fix-flag-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	cwd = join(
		tmpdir(),
		`maina-doctor-fix-flag-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("doctor --fix", () => {
	test("executes each missing row's fix via injected execFn", async () => {
		const calls: string[] = [];
		const execFn = async (cmd: string): Promise<{ exitCode: number }> => {
			calls.push(cmd);
			return { exitCode: 0 };
		};
		const result = await doctorAction({
			cwd,
			home,
			fix: true,
			yes: true,
			execFn,
		});
		const missing = result.mcpHealth.integrations?.filter(
			(i) => i.scope === "missing",
		);
		expect(missing?.length ?? 0).toBeGreaterThan(0);
		for (const row of missing ?? []) {
			expect(calls).toContain(row.fix as string);
		}
	});

	test("--json --fix auto-approves (never blocks on confirm)", async () => {
		const calls: string[] = [];
		const execFn = async (cmd: string): Promise<{ exitCode: number }> => {
			calls.push(cmd);
			return { exitCode: 0 };
		};
		// confirm() is stubbed as `async () => true` in the module mock above,
		// so we cannot detect a hanging call directly — instead, assert that
		// execFn fires for every missing row. Without jsonMode→yes, the loop
		// would still proceed (confirm returns true in the stub), so we also
		// flip confirm to reject to prove jsonMode bypasses the prompt entirely.
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
			// If the code ever asks, it will be told "no" — but it must not ask.
			confirm: async () => false,
		}));
		const result = await doctorAction({
			cwd,
			home,
			fix: true,
			json: true,
			execFn,
		});
		const missing = result.mcpHealth.integrations?.filter(
			(i) => i.scope === "missing",
		);
		expect(missing?.length ?? 0).toBeGreaterThan(0);
		expect(calls.length).toBe(missing?.length ?? 0);
	});

	test("does not call execFn when --fix is absent", async () => {
		let called = 0;
		const execFn = async (_cmd: string): Promise<{ exitCode: number }> => {
			called += 1;
			return { exitCode: 0 };
		};
		await doctorAction({ cwd, home, execFn });
		expect(called).toBe(0);
	});
});
