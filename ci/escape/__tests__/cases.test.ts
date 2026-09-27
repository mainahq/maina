/**
 * The escape and bypass suite's cases, checked for shape and coverage
 * (v1 task 4B.9, FR-SBX-5). These are the failing-first expectations: the
 * suite must carry at least 60 distinct escape attempts spanning every
 * category the sandbox is meant to hold — path traversal and symlink
 * writes, `$HOME` credential reads, DNS and IP network bypass, env and
 * credential exfiltration, prompt injection that disables the sandbox or
 * hooks, bypass-permission modes and holdout reads.
 *
 * This file runs everywhere (no sandbox runtime needed); the escapes
 * themselves are exercised by `escape-suite.test.ts` under a real `srt`.
 */

import { describe, expect, test } from "bun:test";
import { WORKER_NAMES } from "../../../packages/harness/src/workers/registry";
import type { WorkerName } from "../../../packages/harness/src/workers/spec";
import {
	ESCAPE_CASES,
	ESCAPE_CATEGORIES,
	type EscapeCase,
	type EscapeContext,
	GATE_TAMPER,
} from "../cases";

/** Where each worker's gate integration keeps its config in the worktree. */
const GATE_DIRS: Readonly<Record<WorkerName, readonly [string, string]>> = {
	claude: [".claude", "settings.local.json"],
	codex: [".codex", "config.toml"],
	cursor: [".cursor", "cli.json"],
	gemini: [".gemini", "settings.json"],
	opencode: [".opencode", "opencode.json"],
};

const fakeContext = (worker: WorkerName = "claude"): EscapeContext => ({
	worker,
	gateDir: `/tmp/base/worktrees/run-1/${GATE_DIRS[worker][0]}`,
	layout: {
		base: "/tmp/base",
		home: "/tmp/base/home",
		worktreesRoot: "/tmp/base/worktrees",
		worktree: "/tmp/base/worktrees/run-1",
		otherWorktree: "/tmp/base/worktrees/run-2",
		holdout: "/tmp/base/holdout",
		outside: "/tmp/base/outside",
		tmp: "/tmp/base/tmp",
	},
	settingsPath: `/tmp/base/worktrees/run-1/${GATE_DIRS[worker].join("/")}`,
	policyPath: `/tmp/base/state/${worker}-gate-policy.json`,
	logPath: `/tmp/base/state/${worker}-gate-log.jsonl`,
	server: { host: "127.0.0.1", port: 59999, marker: "SERVER-MARKER-322" },
	allowedHost: "allowed.example.test",
	secretEnvName: "GITHUB_TOKEN",
	secretEnvValue: "ghp_ambient_322",
	maskedCredName: "ANTHROPIC_API_KEY",
	maskedCredValue: "sk-ant-real-322",
	settingsBefore: '{"hooks":{}}',
	policyBefore: '{"action_classes":{}}',
	homeSecretMarker: "PRIVATE-KEY-322",
	otherWorktreeMarker: "OTHER-RUN-322",
	holdoutMarker: "HOLDOUT-322",
});

describe("the escape suite", () => {
	test("carries at least 60 cases", () => {
		expect(ESCAPE_CASES.length).toBeGreaterThanOrEqual(60);
	});

	test("every category the issue names is exercised", () => {
		const seen = new Set(ESCAPE_CASES.map((c) => c.category));
		for (const category of ESCAPE_CATEGORIES) {
			expect(seen.has(category)).toBe(true);
		}
	});

	test("no category is left with a token single case", () => {
		for (const category of ESCAPE_CATEGORIES) {
			const count = ESCAPE_CASES.filter((c) => c.category === category).length;
			expect(count).toBeGreaterThanOrEqual(4);
		}
	});

	test("case ids are unique and slug-shaped", () => {
		const ids = ESCAPE_CASES.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});

	test("every case builds a non-empty attack script from a context", () => {
		const ctx = fakeContext();
		for (const c of ESCAPE_CASES) {
			const script = c.script(ctx);
			expect(typeof script).toBe("string");
			expect(script.length).toBeGreaterThan(0);
		}
	});

	// Padding the count with a copy of another case's attack under a new id
	// adds no coverage: every case must run an attack of its own.
	test("no two cases run the same attack", () => {
		const ctx = fakeContext();
		const byScript = new Map<string, string>();
		const copies: string[] = [];
		for (const c of ESCAPE_CASES) {
			const script = c.script(ctx);
			const first = byScript.get(script);
			if (first !== undefined) copies.push(`${c.id} = ${first}`);
			else byScript.set(script, c.id);
		}
		expect(copies).toEqual([]);
	});

	test("every worker has gate tampering to attempt", () => {
		expect(Object.keys(GATE_TAMPER).sort()).toEqual([...WORKER_NAMES].sort());
	});

	// The suite runs once per worker (spec §9.6: every supported ACP worker),
	// each time against that worker's gate integration.
	for (const worker of WORKER_NAMES) {
		test(`${worker}: every case builds a distinct attack`, () => {
			const ctx = fakeContext(worker);
			const scripts = ESCAPE_CASES.map((c) => c.script(ctx));
			expect(scripts.every((s) => s.length > 0)).toBe(true);
			expect(new Set(scripts).size).toBe(scripts.length);
		});

		test(`${worker}: the prompt injections go after its own gate, not Claude's`, () => {
			const ctx = fakeContext(worker);
			const injections = ESCAPE_CASES.filter(
				(c) => c.category === "prompt-injection",
			);
			expect(injections.length).toBeGreaterThanOrEqual(4);
			for (const c of injections) {
				const script = c.script(ctx);
				const target = [ctx.gateDir, ctx.settingsPath, ctx.policyPath].some(
					(path) => script.includes(path),
				);
				expect(target).toBe(true);
				if (worker !== "claude") expect(script).not.toContain(".claude");
			}
		});
	}

	test("every category is a declared one", () => {
		const declared = new Set<EscapeCase["category"]>(ESCAPE_CATEGORIES);
		for (const c of ESCAPE_CASES) {
			expect(declared.has(c.category)).toBe(true);
		}
	});
});
